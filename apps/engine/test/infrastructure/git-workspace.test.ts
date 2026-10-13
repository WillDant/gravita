import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CliGitWorkspace,
  INITIAL_COMMIT_MESSAGE,
  parsePorcelainZ,
} from "../../src/infrastructure/git/cli-git-workspace";
import { GitRunner, gitEnv } from "../../src/infrastructure/git/git-runner";
import { isolatedEnv, sh, userRepo, writeFiles } from "../git-helpers";
import { withTempDir } from "../helpers";

// CliGitWorkspace against real repositories in temp dirs.

const T = 30_000;

function setup(tmp: string, extraEnv: Record<string, string> = {}) {
  const env = { ...isolatedEnv(join(tmp, "home")), ...extraEnv };
  return { env, git: new CliGitWorkspace(new GitRunner({ env })) };
}

describe("CliGitWorkspace", () => {
  test(
    "init turns an empty folder into a repo on main with a .gitignore and a first commit by Gravita",
    async () => {
      await withTempDir(async (tmp) => {
        const { env, git } = setup(tmp);
        const dir = join(tmp, "new");
        await mkdir(dir);
        await writeFile(join(dir, ".DS_Store"), "x");
        expect(await git.isRepo(dir)).toBe(false);
        expect(await git.isEmptyDir(dir)).toBe(true);
        const sha = await git.init(dir);
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
        expect(await git.isRepo(dir)).toBe(true);
        expect(await git.currentBranch(dir)).toBe("main");
        expect(await git.isClean(dir)).toBe(true);
        expect(await readFile(join(dir, ".gitignore"), "utf8")).toContain("node_modules/");
        expect(await sh(dir, env, "log", "--format=%an <%ae>|%s")).toBe(
          `Gravita <gravita@users.noreply.local>|${INITIAL_COMMIT_MESSAGE}`,
        );
        // .DS_Store is ignored, not committed.
        expect(await sh(dir, env, "ls-files")).toBe(".gitignore");
      });
    },
    T,
  );

  test(
    "status, branch and sha helpers",
    async () => {
      await withTempDir(async (tmp) => {
        const { git, env } = setup(tmp);
        const unborn = join(tmp, "unborn");
        await mkdir(unborn);
        await sh(unborn, env, "init", "-q", "-b", "main");
        expect(await git.headSha(unborn)).toBeNull();
        expect(await git.isEmptyDir(join(tmp, "missing"))).toBe(false);

        const repo = join(tmp, "repo");
        await userRepo(repo, env, { "a.txt": "a\n" });
        expect(await git.isClean(repo)).toBe(true);
        await writeFile(join(repo, "new.txt"), "n");
        expect(await git.isClean(repo)).toBe(false);
        await rm(join(repo, "new.txt"));
        await sh(repo, env, "checkout", "-q", "--detach");
        expect(await git.currentBranch(repo)).toBeNull();
        expect(await git.hasPath(repo, "HEAD", "a.txt")).toBe(true);
        expect(await git.hasPath(repo, "HEAD", "b.txt")).toBe(false);
      });
    },
    T,
  );

  test(
    "changedFiles: commits since base, staged, unstaged and untracked; renames as both paths; ignored files left out",
    async () => {
      await withTempDir(async (tmp) => {
        const { git, env } = setup(tmp);
        const repo = join(tmp, "repo");
        await userRepo(repo, env, {
          ".gitignore": "node_modules/\n",
          "a.txt": "a\n",
          "b.txt": "b\n",
          "c.txt": "c\n",
          "old/name.ts": "x\n",
        });
        await sh(repo, env, "switch", "-q", "-c", "work");
        await writeFile(join(repo, "a.txt"), "a2\n");
        await sh(repo, env, "commit", "-q", "-am", "agent commit");
        await writeFile(join(repo, "b.txt"), "b2\n");
        await sh(repo, env, "add", "b.txt");
        await writeFile(join(repo, "c.txt"), "c2\n");
        await writeFiles(repo, { "dir/deep/new.txt": "n", "node_modules/x/index.js": "" });
        await mkdir(join(repo, "new"), { recursive: true });
        await rename(join(repo, "old/name.ts"), join(repo, "new/name.ts"));
        await sh(repo, env, "add", "-A", "old", "new");
        const changed = await git.changedFiles(repo, "main");
        expect(changed.sort()).toEqual(
          ["a.txt", "b.txt", "c.txt", "dir/deep/new.txt", "new/name.ts", "old/name.ts"].sort(),
        );
      });
    },
    T,
  );

  test("parsePorcelainZ reads the source path of a rename", () => {
    expect(parsePorcelainZ("R  new.ts\0old.ts\0?? x y.txt\0 M a\0")).toEqual([
      "new.ts",
      "old.ts",
      "x y.txt",
      "a",
    ]);
  });

  test(
    "commitAll commits as Gravita with a trailer, never runs hooks, and returns null with nothing to commit",
    async () => {
      await withTempDir(async (tmp) => {
        const { git, env } = setup(tmp);
        const repo = join(tmp, "repo");
        await userRepo(repo, env, { "a.txt": "a\n" });
        // A hook that would block every commit and leave a mark if it ran.
        const marker = join(tmp, "hook-ran");
        for (const hook of ["pre-commit", "commit-msg", "post-commit", "post-checkout"]) {
          const path = join(repo, ".git", "hooks", hook);
          await writeFile(path, `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
          await chmod(path, 0o755);
        }
        expect(await git.commitAll(repo, { message: "nothing" })).toBeNull();
        await writeFile(join(repo, "b.txt"), "b\n");
        const sha = await git.commitAll(repo, {
          message: "#1: a title",
          coAuthor: "Backend (Gravita squad) <gravita@users.noreply.local>",
        });
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
        expect(await sh(repo, env, "log", "-1", "--format=%an|%cn|%B")).toBe(
          "Gravita|Gravita|#1: a title\n\nCo-Authored-By: Backend (Gravita squad) <gravita@users.noreply.local>",
        );
        await git.createWorktree(repo, {
          path: join(tmp, "wt"),
          branch: "w",
          from: "HEAD",
        });
        expect(existsSync(marker)).toBe(false);
      });
    },
    T,
  );

  test(
    "commitAll with paths commits only those (a missing one is skipped)",
    async () => {
      await withTempDir(async (tmp) => {
        const { git, env } = setup(tmp);
        const repo = join(tmp, "repo");
        await userRepo(repo, env, { "lock.yaml": "1\n" });
        await writeFiles(repo, { "lock.yaml": "2\n", "junk.txt": "j" });
        await git.commitAll(repo, { message: "lock", paths: ["lock.yaml", "never.lock"] });
        expect(await sh(repo, env, "show", "--name-only", "--format=", "HEAD")).toBe("lock.yaml");
        expect(await git.commitAll(repo, { message: "none", paths: ["never.lock"] })).toBeNull();
      });
    },
    T,
  );

  test(
    "restorePaths puts tracked paths back and deletes ones the source doesn't have",
    async () => {
      await withTempDir(async (tmp) => {
        const { git, env } = setup(tmp);
        const repo = join(tmp, "repo");
        await userRepo(repo, env, { "lock.yaml": "1\n", "a.txt": "a\n" });
        const base = await git.headSha(repo);
        await writeFiles(repo, { "lock.yaml": "2\n", "new.lock": "n", "a.txt": "a2\n" });
        await sh(repo, env, "add", "lock.yaml");
        await git.restorePaths(repo, ["lock.yaml", "new.lock"], base!);
        expect(await readFile(join(repo, "lock.yaml"), "utf8")).toBe("1\n");
        expect(existsSync(join(repo, "new.lock"))).toBe(false);
        expect(await git.changedFiles(repo, "HEAD")).toEqual(["a.txt"]);
      });
    },
    T,
  );

  test(
    "merge: a conflict is aborted and reported, leaving the worktree as it was; threeWayDiff shows each side",
    async () => {
      await withTempDir(async (tmp) => {
        const { git, env } = setup(tmp);
        const repo = join(tmp, "repo");
        await userRepo(repo, env, { "a.txt": "base\n", "b.txt": "b\n" });
        await sh(repo, env, "switch", "-q", "-c", "theirs");
        await writeFile(join(repo, "a.txt"), "theirs\n");
        await sh(repo, env, "commit", "-q", "-am", "theirs");
        await sh(repo, env, "switch", "-q", "main");
        await writeFile(join(repo, "a.txt"), "ours\n");
        await sh(repo, env, "commit", "-q", "-am", "ours");
        const head = await git.headSha(repo);

        const out = await git.merge(repo, "theirs", { message: "merge" });
        expect(out).toEqual({ ok: false, conflicts: ["a.txt"] });
        expect(await git.headSha(repo)).toBe(head);
        expect(await git.isClean(repo)).toBe(true);
        expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);

        expect(await git.threeWayDiff(repo, "theirs", ["a.txt", "none.txt"])).toEqual([
          { path: "a.txt", base: "base\n", ours: "ours\n", theirs: "theirs\n", truncated: false },
          { path: "none.txt", base: null, ours: null, theirs: null, truncated: false },
        ]);
      });
    },
    T,
  );

  test(
    "merge makes a merge commit (or fast-forwards when asked); revertTo goes back and cleans",
    async () => {
      await withTempDir(async (tmp) => {
        const { git, env } = setup(tmp);
        const repo = join(tmp, "repo");
        await userRepo(repo, env, { "a.txt": "a\n" });
        const before = await git.headSha(repo);
        await sh(repo, env, "switch", "-q", "-c", "feature");
        await writeFile(join(repo, "f.txt"), "f\n");
        await sh(repo, env, "add", "f.txt");
        await sh(repo, env, "commit", "-q", "-m", "feature");
        const feature = await git.headSha(repo);
        await sh(repo, env, "switch", "-q", "main");

        const ff = await git.merge(repo, "feature", { message: "ff", fastForward: true });
        expect(ff).toEqual({ ok: true, sha: feature! });
        await git.revertTo(repo, before!);
        const merged = await git.merge(repo, "feature", { message: "Gravita: merge" });
        expect(merged.ok).toBe(true);
        expect(await sh(repo, env, "log", "-1", "--format=%P|%s")).toBe(
          `${before} ${feature}|Gravita: merge`,
        );
        await writeFile(join(repo, "leftover.txt"), "x");
        await git.revertTo(repo, before!);
        expect(await git.headSha(repo)).toBe(before);
        expect(await git.isClean(repo)).toBe(true);
      });
    },
    T,
  );

  test(
    "worktrees: created on a new branch, idempotent, reused when the branch exists, removed with prune",
    async () => {
      await withTempDir(async (tmp) => {
        const { git, env } = setup(tmp);
        const repo = join(tmp, "repo");
        await userRepo(repo, env, { "a.txt": "a\n" });
        const path = join(tmp, "data", "wt", "one");
        const spec = { path, branch: "gravita/s/one", from: "main" };
        await git.createWorktree(repo, spec);
        await git.createWorktree(repo, spec);
        expect(await git.currentBranch(path)).toBe("gravita/s/one");
        await expect(git.createWorktree(repo, { ...spec, branch: "other" })).rejects.toThrow(
          /already a worktree/,
        );
        await writeFile(join(path, "dirty.txt"), "x");
        await git.removeWorktree(repo, path);
        expect(existsSync(path)).toBe(false);
        await git.removeWorktree(repo, path);
        // The branch is kept and a new worktree picks it up.
        await git.createWorktree(repo, spec);
        expect(await git.currentBranch(path)).toBe("gravita/s/one");
        await rm(path, { recursive: true, force: true });
        // A worktree whose folder vanished is pruned, then re-added.
        await git.createWorktree(repo, spec);
        expect(existsSync(join(path, "a.txt"))).toBe(true);
        await git.removeWorktree(repo, path);
        await git.deleteBranch(repo, "gravita/s/one");
        await git.deleteBranch(repo, "gravita/s/one");
        expect(await git.headSha(repo, "refs/heads/gravita/s/one")).toBeNull();
      });
    },
    T,
  );

  test(
    "the user's global config can't change what Gravita does",
    async () => {
      await withTempDir(async (tmp) => {
        const hooks = join(tmp, "evil-hooks");
        const marker = join(tmp, "hook-ran");
        await mkdir(hooks);
        for (const hook of ["pre-commit", "post-checkout", "post-merge", "pre-merge-commit"]) {
          await writeFile(join(hooks, hook), `#!/bin/sh\ntouch "${marker}"\nexit 1\n`);
          await chmod(join(hooks, hook), 0o755);
        }
        const config = join(tmp, "gitconfig");
        await writeFile(
          config,
          [
            "[user]\n\tname = Someone Else\n\temail = someone@example.com",
            "[commit]\n\tgpgsign = true",
            `[core]\n\thooksPath = ${hooks}`,
            "[status]\n\tshowUntrackedFiles = no",
            "[merge]\n\tff = only",
            "[init]\n\tdefaultBranch = trunk",
            "[rerere]\n\tenabled = true",
            "",
          ].join("\n"),
        );
        const { git } = setup(tmp, { GIT_CONFIG_GLOBAL: config });
        const env = isolatedEnv(join(tmp, "home"));
        const dir = join(tmp, "repo");
        await mkdir(dir);
        await git.init(dir);
        expect(await git.currentBranch(dir)).toBe("main");
        await writeFile(join(dir, "untracked.txt"), "u");
        expect(await git.isClean(dir)).toBe(false);
        expect(await git.changedFiles(dir, "HEAD")).toEqual(["untracked.txt"]);
        await git.commitAll(dir, { message: "c" });
        expect(await sh(dir, env, "log", "-1", "--format=%an|%G?")).toBe("Gravita|N");
        await git.createWorktree(dir, { path: join(tmp, "wt"), branch: "b", from: "HEAD" });
        await writeFile(join(tmp, "wt", "b.txt"), "b");
        await git.commitAll(join(tmp, "wt"), { message: "b" });
        await writeFile(join(dir, "m.txt"), "m");
        await git.commitAll(dir, { message: "m" });
        // merge.ff=only would refuse this; Gravita asks for a merge commit explicitly.
        expect((await git.merge(dir, "b", { message: "merge b" })).ok).toBe(true);
        expect(existsSync(marker)).toBe(false);
      });
    },
    T,
  );

  test("the runner drops variables that would redirect git", () => {
    const env = gitEnv({
      PATH: "/bin",
      GIT_DIR: "/elsewhere/.git",
      GIT_WORK_TREE: "/elsewhere",
      GIT_INDEX_FILE: "/i",
      GIT_CONFIG_PARAMETERS: "'user.name=x'",
      GIT_CONFIG_KEY_0: "user.name",
      LANG: "fr_FR.UTF-8",
    });
    expect(env).toMatchObject({
      PATH: "/bin",
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
      LC_ALL: "C",
    });
    for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_CONFIG_PARAMETERS"])
      expect(env[k]).toBeUndefined();
    expect(env.GIT_CONFIG_KEY_0).toBeUndefined();
  });

  test(
    "a GIT_DIR in the engine's environment doesn't redirect commands",
    async () => {
      await withTempDir(async (tmp) => {
        const base = isolatedEnv(join(tmp, "home"));
        const other = join(tmp, "other");
        await userRepo(other, base, { "o.txt": "o" });
        const repo = join(tmp, "repo");
        await userRepo(repo, base, { "r.txt": "r" });
        const git = new CliGitWorkspace(
          new GitRunner({ env: { ...base, GIT_DIR: join(other, ".git") } }),
        );
        expect(await git.hasPath(repo, "HEAD", "r.txt")).toBe(true);
      });
    },
    T,
  );

  test(
    "output over the cap is cut; stdin input reaches git",
    async () => {
      await withTempDir(async (tmp) => {
        const { env } = setup(tmp);
        const repo = join(tmp, "repo");
        await userRepo(repo, env, { "big.txt": "x".repeat(10_000) });
        const runner = new GitRunner({ env, maxOutputBytes: 100 });
        const r = await runner.run(["cat-file", "blob", "HEAD:big.txt"], { cwd: repo });
        expect(r).toMatchObject({ code: 0, truncated: true });
        expect(r.stdout).toHaveLength(100);
        const ok = await runner.run(["cat-file", "blob", "HEAD:big.txt"], {
          cwd: repo,
          maxOutputBytes: 20_000,
        });
        expect(ok.truncated).toBe(false);
        const hashed = await runner.ok(["hash-object", "--stdin"], { cwd: repo, input: "hi" });
        expect(hashed.trim()).toMatch(/^[0-9a-f]{40}$/);
      });
    },
    T,
  );
});
