import { describe, expect, test } from "bun:test";
import { chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AnnounceProject } from "../../src/application/usecases/announce-project";
import {
  compareVersions,
  detectClaude,
  pathFromCommandV,
} from "../../src/infrastructure/claude/claude-cli-locator";
import {
  GitProjectDirectory,
  resolveProject,
} from "../../src/infrastructure/system/git-project-directory";
import { createCore } from "../../src/main/container";
import { withTempDir } from "../helpers";

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`);
};

describe("projects", () => {
  test("a repo and its worktrees are one project; a missing cwd falls back to itself", async () => {
    await withTempDir(async (tmp) => {
      const dir = await realpath(tmp);
      const repo = join(dir, "acme");
      await mkdir(repo);
      git(repo, "init", "-q");
      git(
        repo,
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "init",
      );
      git(repo, "worktree", "add", "-q", join(dir, "acme-feature"));
      await mkdir(join(repo, "packages/web"), { recursive: true });

      const main = await resolveProject(repo);
      expect(main.root).toBe(repo);
      expect(main.name).toBe("acme");
      expect(main.id).toMatch(/^[0-9a-f]{16}$/);
      expect(await resolveProject(join(dir, "acme-feature"))).toEqual(main);
      expect(await resolveProject(join(repo, "packages/web"))).toEqual(main);

      const gone = await resolveProject(join(dir, "deleted-worktree"));
      expect(gone.root).toBe(join(dir, "deleted-worktree"));
      expect(gone.id).not.toBe(main.id);
    });
  });

  test("announces each project once", async () => {
    const core = createCore({ dbPath: ":memory:", demo: false });
    const projects = new AnnounceProject(
      new GitProjectDirectory(async () => "/repos/acme/.git"),
      core.ingest,
      core.clock,
    );
    await projects.execute("/repos/acme", "2026-10-12T10:00:00.000Z");
    await projects.execute("/repos/acme/sub", "2026-10-12T10:00:01.000Z");
    expect(core.events.maxSeq()).toBe(1);
    expect(
      Object.values(core.projection.snapshot().state.projects).map((p) => [p.name, p.root]),
    ).toEqual([["acme", "/repos/acme"]]);
    core.close();
  });
});

describe("claude cli detection", () => {
  test("finds a known path, reads its version and flags old versions", async () => {
    await withTempDir(async (dir) => {
      const bin = join(dir, "claude");
      await writeFile(bin, '#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.100 (Claude Code)"\n');
      await chmod(bin, 0o755);
      const status = await detectClaude({
        shell: "/usr/bin/false",
        knownPaths: [join(dir, "missing"), bin],
      });
      expect(status).toEqual({ found: true, path: bin, version: "2.1.100", outdated: true });
      expect(
        await detectClaude({ shell: "/usr/bin/false", knownPaths: [join(dir, "missing")] }),
      ).toEqual({ found: false });
    });
  });

  test("parses noisy `command -v` output and compares versions", () => {
    expect(pathFromCommandV("some banner\n/opt/homebrew/bin/claude\n")).toBe(
      "/opt/homebrew/bin/claude",
    );
    expect(pathFromCommandV("alias claude='/Users/x/.claude/local/claude'")).toBe(
      "/Users/x/.claude/local/claude",
    );
    expect(pathFromCommandV("claude not found")).toBeUndefined();
    expect(compareVersions("2.1.219", "2.1.219")).toBe(0);
    expect(compareVersions("2.1.296", "2.1.219")).toBeGreaterThan(0);
    expect(compareVersions("2.0.999", "2.1.219")).toBeLessThan(0);
  });
});
