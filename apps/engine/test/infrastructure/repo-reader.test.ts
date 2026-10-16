import { describe, expect, test } from "bun:test";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PullRequestReader } from "../../src/application/ports/repo-reader";
import { GetGitInfo } from "../../src/application/usecases/get-git-info";
import { InvalidCwdError } from "../../src/domain/errors";
import { CliRepoReader, parseStatus } from "../../src/infrastructure/git/cli-repo-reader";
import { summarizeChecks, toPullRequestInfo } from "../../src/infrastructure/git/gh-cli";
import { GitRunner } from "../../src/infrastructure/git/git-runner";
import { NodeWorkspace } from "../../src/infrastructure/system/node-workspace";
import { isolatedEnv, sh, userRepo } from "../git-helpers";
import { withTempDir } from "../helpers";

// The session screen's Git panel: CliRepoReader over real repositories in temp dirs, and the
// pull request summary from gh's JSON.

const T = 30_000;

function setup(tmp: string, prs?: PullRequestReader) {
  const env = isolatedEnv(join(tmp, "home"));
  const repo = new CliRepoReader(new GitRunner({ env }));
  const info = new GetGitInfo({ workspace: new NodeWorkspace(), repo, ...(prs ? { prs } : {}) });
  return { env, repo, info };
}

describe("parseStatus", () => {
  test("reads the branch, the upstream and every kind of change", () => {
    const out = [
      "# branch.oid 0123456789abcdef",
      "# branch.head feat/x",
      "# branch.upstream origin/feat/x",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 aaa bbb src/a file.ts",
      "1 A. N... 000000 100644 100644 000 ccc new.ts",
      "1 D. N... 100644 000000 000000 ddd 000 gone.ts",
      "2 R. N... 100644 100644 100644 eee eee R100 after.ts",
      "before.ts",
      "u UU N... 100644 100644 100644 100644 f1 f2 f3 both.ts",
      "? notes.md",
      "",
    ].join("\0");
    expect(parseStatus(out)).toEqual({
      head: "0123456",
      branch: "feat/x",
      upstream: "origin/feat/x",
      ahead: 2,
      behind: 1,
      files: [
        { path: "src/a file.ts", state: "modified", staged: false },
        { path: "new.ts", state: "added", staged: true },
        { path: "gone.ts", state: "deleted", staged: true },
        { path: "after.ts", from: "before.ts", state: "renamed", staged: true },
        { path: "both.ts", state: "conflicted", staged: false },
        { path: "notes.md", state: "untracked", staged: false },
      ],
    });
  });

  test("a new repository has no head yet, a detached one no branch", () => {
    expect(parseStatus("# branch.oid (initial)\0# branch.head main\0")).toMatchObject({
      branch: "main",
      files: [],
    });
    expect(parseStatus("# branch.oid abcdef1234\0# branch.head (detached)\0").branch).toBeNull();
  });
});

describe("GetGitInfo over a real repository", () => {
  test(
    "branch, files and a diff with untracked files as new ones; no remote, no PR lookup",
    async () => {
      await withTempDir(async (tmp) => {
        let asked = 0;
        const { env, info } = setup(tmp, {
          current: async () => {
            asked++;
            return { pr: null };
          },
        });
        const dir = join(tmp, "repo");
        await userRepo(dir, env, { "a.txt": "one\ntwo\n", "b.txt": "bee\n" });
        await writeFile(join(dir, "a.txt"), "one\n2\n");
        await rm(join(dir, "b.txt"));
        await writeFile(join(dir, "c.txt"), "new\n");
        await sh(dir, env, "checkout", "-q", "-b", "feat/panel");

        const r = await info.execute({ cwd: dir });
        if (!r.repo) throw new Error("expected a repo");
        expect(r.branch).toBe("feat/panel");
        expect(r.head).toMatch(/^[0-9a-f]{7}$/);
        expect(r.files).toEqual([
          { path: "a.txt", state: "modified", staged: false },
          { path: "b.txt", state: "deleted", staged: false },
          { path: "c.txt", state: "untracked", staged: false },
        ]);
        expect(r.diff).toContain("diff --git a/a.txt b/a.txt");
        expect(r.diff).toContain("-two\n+2\n");
        expect(r.diff).toContain("deleted file mode");
        expect(r.diff).toContain("+++ b/c.txt\n@@ -0,0 +1 @@\n+new\n");
        expect(r.diffTruncated).toBe(false);
        expect(r.pr).toBeNull();
        expect(r.prUnavailable).toBe("no-remote");
        expect(asked).toBe(0);

        const summary = await info.execute({ cwd: join(dir), summary: true });
        expect(summary).toMatchObject({ repo: true, diff: "", pr: null });
      });
    },
    T,
  );

  test(
    "with a remote it asks for the branch's PR; a renamed file shows its old path",
    async () => {
      await withTempDir(async (tmp) => {
        const { env, info } = setup(tmp, {
          current: async () => ({ unavailable: "not-logged-in" }),
        });
        const dir = join(tmp, "repo");
        await userRepo(dir, env, { "old.txt": "same content here\n" });
        await sh(dir, env, "remote", "add", "origin", "https://example.com/r.git");
        await rename(join(dir, "old.txt"), join(dir, "new.txt"));
        await sh(dir, env, "add", "-A");
        const r = await info.execute({ cwd: dir });
        if (!r.repo) throw new Error("expected a repo");
        expect(r.files).toEqual([
          { path: "new.txt", from: "old.txt", state: "renamed", staged: true },
        ]);
        expect(r.prUnavailable).toBe("not-logged-in");
      });
    },
    T,
  );

  test(
    "before the first commit everything is new; outside a repo there is nothing",
    async () => {
      await withTempDir(async (tmp) => {
        const { env, info } = setup(tmp);
        const dir = join(tmp, "fresh");
        await sh(tmp, env, "init", "-q", "-b", "main", dir);
        await writeFile(join(dir, "x.txt"), "hello\n");
        await sh(dir, env, "add", "x.txt");
        const r = await info.execute({ cwd: dir });
        if (!r.repo) throw new Error("expected a repo");
        expect(r.head).toBeUndefined();
        expect(r.diff).toContain("+hello");

        expect(await info.execute({ cwd: tmp })).toEqual({ repo: false });
        await expect(info.execute({ cwd: join(tmp, "missing") })).rejects.toBeInstanceOf(
          InvalidCwdError,
        );
      });
    },
    T,
  );
});

describe("pull request summary", () => {
  test("checks: a failure wins, then anything running, else passing", () => {
    expect(summarizeChecks([])).toBeUndefined();
    expect(summarizeChecks([{ status: "COMPLETED", conclusion: "SUCCESS" }])).toBe("passing");
    expect(summarizeChecks([{ status: "IN_PROGRESS", conclusion: "" }, { state: "SUCCESS" }])).toBe(
      "pending",
    );
    expect(
      summarizeChecks([{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "FAILURE" }]),
    ).toBe("failing");
    expect(summarizeChecks([{ state: "PENDING" }])).toBe("pending");
  });

  test("gh's JSON becomes the protocol's PR", () => {
    expect(
      toPullRequestInfo({
        number: 7,
        title: "Add the Git panel",
        url: "https://github.com/o/r/pull/7",
        state: "OPEN",
        isDraft: true,
        baseRefName: "main",
        reviewDecision: "REVIEW_REQUIRED",
        statusCheckRollup: [],
      }),
    ).toEqual({
      number: 7,
      title: "Add the Git panel",
      url: "https://github.com/o/r/pull/7",
      state: "open",
      draft: true,
      base: "main",
      review: "review-required",
    });
  });
});
