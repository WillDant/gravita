import { existsSync } from "node:fs";
import { mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  CommitOptions,
  GitWorkspace,
  MergeOutcome,
  ThreeWayFile,
  WorktreeSpec,
} from "../../application/ports/git-workspace";
import { GitCommandError, type GitRunner } from "./git-runner";

// GitWorkspace over the git CLI. Output is read in machine formats (-z, porcelain) and
// every command that could be changed by the user's config gets an explicit flag.

/** What a folder Gravita initialises ignores from the start. */
export const INITIAL_GITIGNORE = "node_modules/\ndist/\n.env*\n!.env.example\n.DS_Store\n";
export const INITIAL_COMMIT_MESSAGE = "Gravita: start";

/** Per side of a conflict view. */
export const THREE_WAY_CAP_BYTES = 64 * 1024;
const PUSH_TIMEOUT_MS = 120_000;

/** Folders whose only entries are these count as empty (Finder leaves .DS_Store behind). */
const NOISE = new Set([".DS_Store"]);

const splitZ = (s: string): string[] => s.split("\0").filter((x) => x !== "");

function addOnce(list: string[], seen: Set<string>, path: string) {
  if (seen.has(path)) return;
  seen.add(path);
  list.push(path);
}

async function canonical(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

/** Parses `git status --porcelain=v1 -z`: "XY path", plus the source path of a rename/copy. */
export function parsePorcelainZ(out: string): string[] {
  const fields = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (!f || f.length < 4) continue;
    paths.push(f.slice(3));
    const x = f[0];
    if (x === "R" || x === "C") {
      const from = fields[++i];
      if (from) paths.push(from);
    }
  }
  return paths;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
}

export class CliGitWorkspace implements GitWorkspace {
  constructor(private readonly git: GitRunner) {}

  async isRepo(dir: string): Promise<boolean> {
    try {
      const r = await this.git.run(["rev-parse", "--is-inside-work-tree"], { cwd: dir });
      return r.code === 0 && r.stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  async topLevel(dir: string): Promise<string> {
    return (await this.git.ok(["rev-parse", "--show-toplevel"], { cwd: dir })).trim();
  }

  async isEmptyDir(dir: string): Promise<boolean> {
    try {
      return (await readdir(dir)).every((name) => NOISE.has(name));
    } catch {
      return false;
    }
  }

  async init(dir: string): Promise<string> {
    await this.git.ok(["init", "-q", "-b", "main"], { cwd: dir });
    await writeFile(join(dir, ".gitignore"), INITIAL_GITIGNORE, { flag: "wx" }).catch((err) => {
      // An existing .gitignore (e.g. only dotfiles were there) is kept as is.
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    });
    await this.git.ok(["add", "-A"], { cwd: dir });
    await this.commit(dir, INITIAL_COMMIT_MESSAGE);
    return (await this.headSha(dir)) ?? "";
  }

  async currentBranch(repo: string): Promise<string | null> {
    const r = await this.git.run(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: repo });
    return r.code === 0 ? r.stdout.trim() || null : null;
  }

  async isClean(repo: string): Promise<boolean> {
    const out = await this.git.ok(
      ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignore-submodules=none"],
      { cwd: repo },
    );
    return out === "";
  }

  async headSha(repo: string, ref = "HEAD"): Promise<string | null> {
    const r = await this.git.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: repo,
    });
    return r.code === 0 ? r.stdout.trim() || null : null;
  }

  async mergeBase(repo: string, a: string, b: string): Promise<string | null> {
    const r = await this.git.run(["merge-base", a, b], { cwd: repo });
    return r.code === 0 ? r.stdout.trim() || null : null;
  }

  async hasPath(repo: string, ref: string, path: string): Promise<boolean> {
    const r = await this.git.run(["cat-file", "-e", `${ref}:${path}`], { cwd: repo });
    return r.code === 0;
  }

  async readFile(
    repo: string,
    ref: string,
    path: string,
    maxBytes: number,
  ): Promise<{ text: string; truncated: boolean } | null> {
    const r = await this.git.run(["cat-file", "blob", `${ref}:${path}`], {
      cwd: repo,
      maxOutputBytes: maxBytes,
    });
    return r.code === 0 ? { text: r.stdout, truncated: r.truncated } : null;
  }

  private async worktrees(repo: string): Promise<WorktreeEntry[]> {
    const out = await this.git.ok(["worktree", "list", "--porcelain", "-z"], { cwd: repo });
    const entries: WorktreeEntry[] = [];
    let cur: WorktreeEntry | undefined;
    for (const line of out.split("\0")) {
      if (line.startsWith("worktree ")) {
        cur = { path: line.slice("worktree ".length), branch: null };
        entries.push(cur);
      } else if (line.startsWith("branch ") && cur) {
        cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      }
    }
    return entries;
  }

  private async findWorktree(repo: string, path: string): Promise<WorktreeEntry | undefined> {
    const want = await canonical(path);
    for (const w of await this.worktrees(repo)) {
      if (w.path === path || (await canonical(w.path)) === want) return w;
    }
    return undefined;
  }

  async createWorktree(repo: string, spec: WorktreeSpec): Promise<void> {
    // Entries whose folder is gone (a crash, a manual delete) would block the path.
    await this.git.ok(["worktree", "prune"], { cwd: repo });
    const existing = await this.findWorktree(repo, spec.path);
    if (existing) {
      if (existing.branch === spec.branch) return;
      throw new GitCommandError(
        ["worktree", "add", spec.path],
        null,
        `${spec.path} is already a worktree on ${existing.branch ?? "a detached HEAD"}`,
      );
    }
    await mkdir(dirname(spec.path), { recursive: true, mode: 0o700 });
    const branchExists =
      (
        await this.git.run(["show-ref", "--verify", "--quiet", `refs/heads/${spec.branch}`], {
          cwd: repo,
        })
      ).code === 0;
    // --no-track: tracking would be written to the repository's config.
    const argv = branchExists
      ? ["worktree", "add", "--quiet", spec.path, spec.branch]
      : ["worktree", "add", "--quiet", "--no-track", "-b", spec.branch, spec.path, spec.from];
    await this.git.ok(argv, { cwd: repo, timeoutMs: 120_000 });
  }

  async removeWorktree(repo: string, path: string): Promise<void> {
    if (await this.findWorktree(repo, path)) {
      await this.git.ok(["worktree", "remove", "--force", path], { cwd: repo, timeoutMs: 120_000 });
    }
    await this.git.ok(["worktree", "prune"], { cwd: repo });
  }

  async deleteBranch(repo: string, branch: string): Promise<void> {
    const exists =
      (
        await this.git.run(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
          cwd: repo,
        })
      ).code === 0;
    if (exists) await this.git.ok(["branch", "-D", "--", branch], { cwd: repo });
  }

  async changedFiles(worktree: string, base: string): Promise<string[]> {
    const committed = await this.git.ok(
      ["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", `${base}...HEAD`, "--"],
      { cwd: worktree },
    );
    const status = await this.git.ok(
      [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--no-renames",
        "--ignore-submodules=none",
      ],
      { cwd: worktree },
    );
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of splitZ(committed)) addOnce(out, seen, p);
    for (const p of parsePorcelainZ(status)) addOnce(out, seen, p);
    return out;
  }

  private async commit(worktree: string, message: string): Promise<void> {
    // --no-verify (and no hooks at all, see GIT_CONFIG_ARGS): a repository's pre-commit or
    // commit-msg hook is arbitrary code; it could block Gravita's commit or run anything with
    // the user's rights. Checks run as plan checks instead, visible and approved by the user.
    await this.git.ok(["commit", "--quiet", "--no-verify", "--cleanup=whitespace", "-F", "-"], {
      cwd: worktree,
      input: message,
    });
  }

  async commitAll(worktree: string, o: CommitOptions): Promise<string | null> {
    let scope: string[] = [];
    if (o.paths) {
      // `git add` fails on a pathspec that matches nothing (a lockfile never generated).
      const present: string[] = [];
      for (const p of o.paths)
        if (existsSync(join(worktree, p)) || (await this.hasPath(worktree, "HEAD", p)))
          present.push(p);
      if (!present.length) return null;
      scope = ["--", ...present];
    }
    await this.git.ok(["add", "-A", ...scope], { cwd: worktree });
    const staged = await this.git.run(["diff", "--cached", "--quiet", "--no-ext-diff"], {
      cwd: worktree,
    });
    if (staged.code === 0) return null;
    const message = o.coAuthor ? `${o.message}\n\nCo-Authored-By: ${o.coAuthor}\n` : o.message;
    await this.commit(worktree, message);
    return this.headSha(worktree);
  }

  async restorePaths(worktree: string, paths: readonly string[], from: string): Promise<void> {
    const back: string[] = [];
    const drop: string[] = [];
    for (const p of paths) ((await this.hasPath(worktree, from, p)) ? back : drop).push(p);
    if (back.length)
      await this.git.ok(["restore", `--source=${from}`, "--staged", "--worktree", "--", ...back], {
        cwd: worktree,
      });
    if (drop.length) {
      await this.git.ok(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ...drop], {
        cwd: worktree,
      });
      for (const p of drop) {
        const abs = resolve(worktree, p);
        const rel = relative(worktree, abs);
        if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue;
        await rm(abs, { recursive: true, force: true });
      }
    }
  }

  async merge(
    worktree: string,
    branch: string,
    o: { message: string; fastForward?: boolean },
  ): Promise<MergeOutcome> {
    const r = await this.git.run(
      [
        "merge",
        "--quiet",
        "--no-edit",
        "--no-verify",
        "--no-autostash",
        o.fastForward ? "--ff" : "--no-ff",
        "-m",
        o.message,
        branch,
      ],
      { cwd: worktree, timeoutMs: 120_000 },
    );
    if (r.code === 0) return { ok: true, sha: (await this.headSha(worktree)) ?? "" };
    const unmerged = await this.git.ok(["diff", "--name-only", "-z", "--diff-filter=U"], {
      cwd: worktree,
    });
    const conflicts = splitZ(unmerged);
    // Abort whatever the merge left behind (MERGE_HEAD, half-written files).
    await this.git.run(["merge", "--abort"], { cwd: worktree });
    if (conflicts.length) return { ok: false, conflicts };
    throw new GitCommandError(["merge", branch], r.code, r.stderr || r.stdout);
  }

  async revertTo(worktree: string, sha: string): Promise<void> {
    await this.git.ok(["reset", "--hard", "--quiet", sha], { cwd: worktree });
    // Untracked leftovers (check output, a half-regenerated lockfile); ignored files such as
    // node_modules stay, so the next check doesn't reinstall everything.
    await this.git.ok(["clean", "-fdq"], { cwd: worktree });
  }

  private async blob(worktree: string, rev: string | null, path: string) {
    if (!rev) return { text: null, truncated: false };
    const r = await this.git.run(["cat-file", "blob", `${rev}:${path}`], {
      cwd: worktree,
      maxOutputBytes: THREE_WAY_CAP_BYTES,
    });
    return r.code === 0
      ? { text: r.stdout, truncated: r.truncated }
      : { text: null, truncated: false };
  }

  async threeWayDiff(
    worktree: string,
    branch: string,
    paths: readonly string[],
  ): Promise<ThreeWayFile[]> {
    const base = await this.mergeBase(worktree, "HEAD", branch);
    const files: ThreeWayFile[] = [];
    for (const path of paths) {
      const [b, o, t] = await Promise.all([
        this.blob(worktree, base, path),
        this.blob(worktree, "HEAD", path),
        this.blob(worktree, branch, path),
      ]);
      files.push({
        path,
        base: b.text,
        ours: o.text,
        theirs: t.text,
        truncated: b.truncated || o.truncated || t.truncated,
      });
    }
    return files;
  }

  async hasRemote(repo: string, remote = "origin"): Promise<boolean> {
    const r = await this.git.run(["remote", "get-url", "--", remote], { cwd: repo });
    return r.code === 0 && r.stdout.trim() !== "";
  }

  async push(repo: string, branch: string, remote = "origin"): Promise<void> {
    // No upstream is set (-u would write to the repository's config).
    await this.git.ok(
      ["push", "--quiet", "--no-verify", remote, `refs/heads/${branch}:refs/heads/${branch}`],
      { cwd: repo, timeoutMs: PUSH_TIMEOUT_MS },
    );
  }
}
