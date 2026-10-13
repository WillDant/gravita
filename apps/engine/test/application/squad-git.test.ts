import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { keys } from "@gravita/protocol";
import type { PullRequestHost } from "../../src/application/ports/git-workspace";
import { DeliverSquad } from "../../src/application/usecases/deliver-squad";
import { REGENERATE_MESSAGE } from "../../src/application/usecases/regenerate-shared";
import { SYNC_MESSAGE } from "../../src/application/usecases/sync-role-branch";
import {
  DirtyWorktreeError,
  GhUnavailableError,
  InvalidSquadPlanError,
  NotARepositoryError,
  SquadWorkspaceError,
} from "../../src/domain/errors";
import { GhCli } from "../../src/infrastructure/git/gh-cli";
import {
  BASE_FILES,
  eventsOf,
  sh,
  squadHarness,
  testPlan,
  userRepo,
  writeFiles,
} from "../git-helpers";
import { withTempDir } from "../helpers";

// The squad's git use cases over real repositories in temp dirs ($0, no agents).

const T = 60_000;
const SQ = "sq1";
const P = "proj1";

async function prepared(tmp: string, plan = testPlan(), over = {}) {
  const h = squadHarness(tmp, over);
  const repo = join(tmp, "repo");
  await userRepo(repo, h.env, BASE_FILES);
  const ws = await h.kit.prepare.execute({ squadId: SQ, projectId: P, cwd: repo, plan });
  return { ...h, repo, ws, plan };
}

/** Writes into a role's worktree and runs the commit gate for a task. */
async function finishTask(
  ctx: Awaited<ReturnType<typeof prepared>>,
  roleId: string,
  taskId: string,
  files: Record<string, string>,
  attempt = 1,
) {
  const wt = ctx.ws.roles[roleId]!.path;
  await writeFiles(wt, files);
  return ctx.kit.commitTask.execute({
    squadId: SQ,
    projectId: P,
    plan: ctx.plan,
    roleId,
    taskId,
    attempt,
    worktree: wt,
    base: ctx.ws.integration.branch,
  });
}

const job = (ctx: Awaited<ReturnType<typeof prepared>>, roleId: string, taskId: string) => ({
  squadId: SQ,
  projectId: P,
  plan: ctx.plan,
  roleId,
  taskId,
  attempt: 1,
  roleBranch: ctx.ws.roles[roleId]!.branch,
});

describe("PrepareSquadWorkspace", () => {
  test(
    "an empty folder becomes a repo; integration and one worktree per writing role",
    async () => {
      await withTempDir(async (tmp) => {
        const h = squadHarness(tmp);
        const dir = join(tmp, "empty");
        await mkdir(dir);
        const ws = await h.kit.prepare.execute({
          squadId: SQ,
          projectId: P,
          cwd: dir,
          plan: testPlan(),
        });
        expect(ws.initialized).toBe(true);
        expect(ws.baseBranch).toBe("main");
        expect(ws.integration).toEqual({
          path: join(h.worktreesRoot, P, SQ, "integration"),
          branch: `gravita/${SQ}/integration`,
        });
        expect(Object.keys(ws.roles)).toEqual(["backend", "frontend"]);
        expect(await h.git.headSha(ws.integration.path)).toBe(ws.baseSha);
        for (const role of ["backend", "frontend"]) {
          const ref = ws.roles[role]!;
          expect(ref.path).toBe(join(h.worktreesRoot, P, SQ, role));
          expect(await h.git.currentBranch(ref.path)).toBe(`gravita/${SQ}/${role}`);
          expect(await h.git.headSha(ref.path)).toBe(ws.baseSha);
        }
        // Nothing but git's own metadata lands in the user's folder.
        expect(await h.git.isClean(dir)).toBe(true);
      });
    },
    T,
  );

  test(
    "refuses a non-empty folder that isn't a repo, and a dirty repo",
    async () => {
      await withTempDir(async (tmp) => {
        const h = squadHarness(tmp);
        const plan = testPlan();
        const loose = join(tmp, "loose");
        await writeFiles(loose, { "notes.txt": "mine" });
        await expect(
          h.kit.prepare.execute({ squadId: SQ, projectId: P, cwd: loose, plan }),
        ).rejects.toBeInstanceOf(NotARepositoryError);
        expect(existsSync(join(loose, ".git"))).toBe(false);

        const repo = join(tmp, "repo");
        await userRepo(repo, h.env, BASE_FILES);
        await writeFile(join(repo, "wip.txt"), "uncommitted");
        await expect(
          h.kit.prepare.execute({ squadId: SQ, projectId: P, cwd: repo, plan }),
        ).rejects.toBeInstanceOf(DirtyWorktreeError);
        expect(existsSync(h.worktreesRoot)).toBe(false);
      });
    },
    T,
  );

  test(
    "refuses a role id that would collide with integration, a detached HEAD and an unknown base",
    async () => {
      await withTempDir(async (tmp) => {
        const h = squadHarness(tmp);
        const repo = join(tmp, "repo");
        await userRepo(repo, h.env, BASE_FILES);
        const base = testPlan();
        const plan = testPlan({
          roles: [
            ...base.roles,
            { id: "integration", name: "X", kind: "custom", owns: ["x/"], charter: "" },
          ],
        });
        await expect(
          h.kit.prepare.execute({ squadId: SQ, projectId: P, cwd: repo, plan }),
        ).rejects.toBeInstanceOf(InvalidSquadPlanError);
        await expect(
          h.kit.prepare.execute({
            squadId: SQ,
            projectId: P,
            cwd: repo,
            plan: base,
            baseBranch: "nope",
          }),
        ).rejects.toMatchObject({ reason: "unknown-branch" });
        await expect(
          h.kit.prepare.execute({ squadId: "../x", projectId: P, cwd: repo, plan: base }),
        ).rejects.toMatchObject({ reason: "invalid-id" });
        await sh(repo, h.env, "checkout", "-q", "--detach");
        await expect(
          h.kit.prepare.execute({ squadId: SQ, projectId: P, cwd: repo, plan: base }),
        ).rejects.toBeInstanceOf(SquadWorkspaceError);
      });
    },
    T,
  );

  test(
    "preparing again reuses everything; cleanup removes the worktrees and keeps the branches",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp);
        await writeFiles(ctx.ws.roles.backend!.path, { "apps/api/wip.ts": "wip" });
        const again = await ctx.kit.prepare.execute({
          squadId: SQ,
          projectId: P,
          cwd: ctx.repo,
          plan: ctx.plan,
        });
        expect(again).toEqual(ctx.ws);
        // The role's work in progress survived.
        expect(existsSync(join(ctx.ws.roles.backend!.path, "apps/api/wip.ts"))).toBe(true);

        await ctx.kit.cleanup.execute({
          squadId: SQ,
          projectId: P,
          repo: ctx.repo,
          plan: ctx.plan,
        });
        for (const ref of [ctx.ws.integration, ...Object.values(ctx.ws.roles)]) {
          expect(existsSync(ref.path)).toBe(false);
          expect(await ctx.git.headSha(ctx.repo, `refs/heads/${ref.branch}`)).not.toBeNull();
        }
        await ctx.kit.cleanup.execute({
          squadId: SQ,
          projectId: P,
          repo: ctx.repo,
          plan: ctx.plan,
          deleteBranches: true,
        });
        expect(await sh(ctx.repo, ctx.env, "branch", "--list", "gravita/*")).toBe("");
      });
    },
    T,
  );
});

describe("CommitTask (the commit gate)", () => {
  test(
    "an in-scope change is committed by Gravita with the role's trailer",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp);
        const r = await finishTask(ctx, "backend", "api-1", {
          "apps/api/index.ts": "export const api = 2;\n",
          "apps/api/routes/new.ts": "export {};\n",
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(r.files.sort()).toEqual(["apps/api/index.ts", "apps/api/routes/new.ts"]);
        const wt = ctx.ws.roles.backend!.path;
        expect(await sh(wt, ctx.env, "log", "-1", "--format=%an <%ae>|%B")).toBe(
          "Gravita <gravita@users.noreply.local>|api-1: Add the API\n\nCo-Authored-By: Backend (Gravita squad) <gravita@users.noreply.local>",
        );
        expect(await ctx.git.isClean(wt)).toBe(true);
        const [created] = eventsOf(ctx.store, "commit.created");
        expect(created).toMatchObject({
          key: keys.commit(SQ, r.sha!),
          source: "gravita",
          provider: "gravita",
          projectId: P,
          data: { squadId: SQ, role: "backend", taskId: "api-1", sha: r.sha },
        });
        expect(created?.sessionId).toBeUndefined();
      });
    },
    T,
  );

  test(
    "an out-of-scope change is a violation: no commit, the worktree is left as it is",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp);
        const wt = ctx.ws.roles.backend!.path;
        const head = await ctx.git.headSha(wt);
        const r = await finishTask(ctx, "backend", "api-1", {
          "apps/api/index.ts": "export const api = 2;\n",
          "apps/web/index.ts": "hijacked\n",
          "README.md": "rewritten\n",
        });
        expect(r).toEqual({ ok: false, violation: ["README.md", "apps/web/index.ts"] });
        expect(await ctx.git.headSha(wt)).toBe(head);
        expect(await readFile(join(wt, "apps/web/index.ts"), "utf8")).toBe("hijacked\n");
        expect(eventsOf(ctx.store, "commit.created")).toEqual([]);
        expect(eventsOf(ctx.store, "ownership.violation")).toMatchObject([
          {
            key: keys.ownershipViolation(SQ, "api-1", 1),
            data: {
              squadId: SQ,
              role: "backend",
              taskId: "api-1",
              attempt: 1,
              paths: ["README.md", "apps/web/index.ts"],
            },
          },
        ]);
      });
    },
    T,
  );

  test(
    "a rename into another role's paths counts as outside",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp);
        const wt = ctx.ws.roles.backend!.path;
        await sh(wt, ctx.env, "mv", "apps/api/index.ts", "apps/web/moved.ts");
        const r = await finishTask(ctx, "backend", "api-1", {});
        expect(r).toEqual({ ok: false, violation: ["apps/web/moved.ts"] });
      });
    },
    T,
  );

  test(
    "shared files are put back and left out of the commit",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp);
        const r = await finishTask(ctx, "frontend", "web-1", {
          "apps/web/index.ts": "export const web = 2;\n",
          "pnpm-lock.yaml": "lockfileVersion: 9\nchanged: true\n",
          "package.json": '{ "name": "demo", "dependencies": { "react": "19" } }\n',
        });
        expect(r).toMatchObject({
          ok: true,
          files: ["apps/web/index.ts"],
          restored: ["package.json", "pnpm-lock.yaml"],
        });
        const wt = ctx.ws.roles.frontend!.path;
        expect(await readFile(join(wt, "pnpm-lock.yaml"), "utf8")).toBe(
          BASE_FILES["pnpm-lock.yaml"],
        );
        expect(await sh(wt, ctx.env, "show", "--name-only", "--format=", "HEAD")).toBe(
          "apps/web/index.ts",
        );
        expect(await ctx.git.isClean(wt)).toBe(true);
      });
    },
    T,
  );

  test(
    "nothing changed: no commit, no event",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp);
        expect(await finishTask(ctx, "backend", "api-1", {})).toEqual({
          ok: true,
          sha: null,
          files: [],
          restored: [],
        });
        expect(ctx.store.rows).toEqual([]);
      });
    },
    T,
  );
});

describe("MergeQueue", () => {
  test(
    "two roles' tasks merge in the order they were queued, each green",
    async () => {
      await withTempDir(async (tmp) => {
        const plan = testPlan({
          checks: [
            {
              id: "has-api",
              argv: ["node", "-e", "require('fs').accessSync('apps/api/index.ts')"],
              cwd: ".",
              when: "integration",
            },
          ],
        });
        const ctx = await prepared(tmp, plan);
        await finishTask(ctx, "backend", "api-1", { "apps/api/server.ts": "server\n" });
        await finishTask(ctx, "frontend", "web-1", { "apps/web/page.ts": "page\n" });
        const [a, b] = await Promise.all([
          ctx.kit.mergeQueue.enqueue(job(ctx, "backend", "api-1")),
          ctx.kit.mergeQueue.enqueue(job(ctx, "frontend", "web-1")),
        ]);
        expect(a.status).toBe("merged");
        expect(b.status).toBe("merged");
        expect(ctx.kit.mergeQueue.busy(SQ)).toBe(false);
        const merges = ctx.store.rows
          .filter((e) => e.type.startsWith("merge.") || e.type === "check.ran")
          .map((e) => `${e.type}:${"taskId" in e.data ? e.data.taskId : ""}`);
        expect(merges).toEqual([
          "merge.started:api-1",
          "check.ran:",
          "merge.succeeded:api-1",
          "merge.started:web-1",
          "check.ran:",
          "merge.succeeded:web-1",
        ]);
        const integration = ctx.ws.integration.path;
        const head = await ctx.git.headSha(integration);
        expect(b).toMatchObject({ status: "merged", sha: head });
        expect(existsSync(join(integration, "apps/api/server.ts"))).toBe(true);
        expect(existsSync(join(integration, "apps/web/page.ts"))).toBe(true);
        expect(eventsOf(ctx.store, "merge.succeeded").at(-1)).toMatchObject({
          key: keys.merge(SQ, "web-1", 1, "succeeded"),
          data: { squadId: SQ, taskId: "web-1", role: "frontend", attempt: 1, sha: head },
        });
        expect(eventsOf(ctx.store, "check.ran")[0]).toMatchObject({
          key: keys.checkRan(SQ, "has-api", "merge-api-1-1"),
          data: { checkId: "has-api", runId: "merge-api-1-1", ok: true },
        });
      });
    },
    T,
  );

  test(
    "a conflicting change is reported and integration is left untouched",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp);
        // Ownership keeps roles apart; a conflict still happens when a branch carries a
        // change made outside the gate. Craft one on each role branch.
        for (const role of ["backend", "frontend"]) {
          const wt = ctx.ws.roles[role]!.path;
          await writeFile(join(wt, "README.md"), `# ${role}\n`);
          await sh(wt, ctx.env, "commit", "-q", "-am", role);
        }
        expect((await ctx.kit.mergeQueue.enqueue(job(ctx, "backend", "api-1"))).status).toBe(
          "merged",
        );
        const before = await ctx.git.headSha(ctx.ws.integration.path);
        const r = await ctx.kit.mergeQueue.enqueue(job(ctx, "frontend", "web-1"));
        expect(r).toEqual({ status: "conflicted", paths: ["README.md"] });
        expect(await ctx.git.headSha(ctx.ws.integration.path)).toBe(before);
        expect(await ctx.git.isClean(ctx.ws.integration.path)).toBe(true);
        expect(eventsOf(ctx.store, "merge.conflicted")).toMatchObject([
          {
            key: keys.merge(SQ, "web-1", 1, "conflicted"),
            data: { taskId: "web-1", role: "frontend", paths: ["README.md"] },
          },
        ]);
      });
    },
    T,
  );

  test(
    "a red integration check reverts the merge to the previous sha",
    async () => {
      await withTempDir(async (tmp) => {
        const plan = testPlan({
          checks: [
            {
              id: "no-broken",
              argv: [
                "node",
                "-e",
                "if (require('fs').existsSync('apps/web/broken.ts')) { console.error('broken!'); process.exitCode = 1 }",
              ],
              cwd: ".",
              when: "integration",
            },
            { id: "later", argv: ["node", "-e", "1"], cwd: ".", when: "integration" },
          ],
        });
        const ctx = await prepared(tmp, plan);
        const before = await ctx.git.headSha(ctx.ws.integration.path);
        await finishTask(ctx, "frontend", "web-1", { "apps/web/broken.ts": "oops\n" });
        const r = await ctx.kit.mergeQueue.enqueue(job(ctx, "frontend", "web-1"));
        expect(r).toMatchObject({ status: "reverted", toSha: before, checkId: "no-broken" });
        if (r.status === "reverted") expect(r.output).toContain("broken!");
        expect(await ctx.git.headSha(ctx.ws.integration.path)).toBe(before);
        expect(existsSync(join(ctx.ws.integration.path, "apps/web/broken.ts"))).toBe(false);
        expect(eventsOf(ctx.store, "merge.reverted")).toMatchObject([
          {
            key: keys.merge(SQ, "web-1", 1, "reverted"),
            data: { taskId: "web-1", role: "frontend", toSha: before, checkId: "no-broken" },
          },
        ]);
        // Fail fast: the second check never ran.
        expect(eventsOf(ctx.store, "check.ran")).toMatchObject([
          {
            data: {
              checkId: "no-broken",
              ok: false,
              outputPreview: expect.stringContaining("broken!"),
            },
          },
        ]);
        expect(eventsOf(ctx.store, "merge.succeeded")).toEqual([]);
      });
    },
    T,
  );
});

describe("RegenerateShared", () => {
  const writeLock = {
    // Stands in for `pnpm install --lockfile-only`: rewrites the lockfile, nothing else.
    "pnpm-lock.yaml": {
      argv: [
        "node",
        "-e",
        "require('fs').appendFileSync('pnpm-lock.yaml', 'regenerated: true\\n')",
      ],
    },
  };

  test(
    "after a merge that touched a manifest, the lockfile is regenerated and committed as Gravita",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp, testPlan(), { lockfileCommands: writeLock });
        await finishTask(ctx, "frontend", "web-1", {
          "apps/web/package.json": '{ "name": "web" }\n',
        });
        const r = await ctx.kit.mergeQueue.enqueue(job(ctx, "frontend", "web-1"));
        expect(r.status).toBe("merged");
        if (r.status !== "merged") return;
        expect(r.regeneration.lockfiles).toEqual([
          { lockfile: "pnpm-lock.yaml", status: "regenerated" },
        ]);
        expect(r.regeneration.sha).toBe(r.sha);
        const integration = ctx.ws.integration.path;
        expect(await sh(integration, ctx.env, "log", "-1", "--format=%an|%s")).toBe(
          `Gravita|${REGENERATE_MESSAGE}`,
        );
        expect(await readFile(join(integration, "pnpm-lock.yaml"), "utf8")).toContain(
          "regenerated: true",
        );
      });
    },
    T,
  );

  test(
    "skips cleanly when no manifest changed or the manager isn't installed",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp);
        const integration = ctx.ws.integration.path;
        const noManifest = await ctx.kit.regenerateShared.execute({
          plan: ctx.plan,
          worktree: integration,
          changed: ["apps/api/index.ts"],
        });
        expect(noManifest).toEqual({
          lockfiles: [
            { lockfile: "pnpm-lock.yaml", status: "skipped", note: "no manifest changed" },
          ],
          sha: null,
        });
        // A PATH without pnpm: the real command is looked up and skipped.
        const bare = squadHarness(tmp, { checkEnv: () => ({ PATH: join(tmp, "no-bin") }) });
        const missing = await bare.kit.regenerateShared.execute({
          plan: ctx.plan,
          worktree: integration,
        });
        expect(missing).toEqual({
          lockfiles: [
            { lockfile: "pnpm-lock.yaml", status: "skipped", note: "pnpm is not installed" },
          ],
          sha: null,
        });
        expect(await ctx.git.isClean(integration)).toBe(true);
        const none = await ctx.kit.regenerateShared.execute({
          plan: testPlan({ shared: { paths: [".github/"], strategy: "regenerate" } }),
          worktree: integration,
        });
        expect(none).toEqual({ lockfiles: [], sha: null });
      });
    },
    T,
  );
});

describe("SyncRoleBranch", () => {
  test(
    "fast-forwards a role with nothing new, merges otherwise, and returns conflicts aborted",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp);
        await finishTask(ctx, "backend", "api-1", { "apps/api/server.ts": "server\n" });
        await ctx.kit.mergeQueue.enqueue(job(ctx, "backend", "api-1"));
        const integrationHead = await ctx.git.headSha(ctx.ws.integration.path);
        const web = ctx.ws.roles.frontend!.path;
        const ff = await ctx.kit.syncRoleBranch.execute({
          roleWorktree: web,
          integrationBranch: ctx.ws.integration.branch,
        });
        expect(ff).toEqual({ ok: true, sha: integrationHead! });

        // The backend role has its own commit after the merge: a merge commit.
        await finishTask(ctx, "backend", "api-1", { "apps/api/more.ts": "more\n" }, 2);
        await finishTask(ctx, "frontend", "web-1", { "apps/web/page.ts": "page\n" });
        await ctx.kit.mergeQueue.enqueue(job(ctx, "frontend", "web-1"));
        const api = ctx.ws.roles.backend!.path;
        const merged = await ctx.kit.syncRoleBranch.execute({
          roleWorktree: api,
          integrationBranch: ctx.ws.integration.branch,
        });
        expect(merged.ok).toBe(true);
        expect(await sh(api, ctx.env, "log", "-1", "--format=%s")).toBe(SYNC_MESSAGE);
        expect(existsSync(join(api, "apps/web/page.ts"))).toBe(true);

        // Integration and the role both changed a file (outside the gate): a conflict.
        await writeFile(join(ctx.ws.integration.path, "README.md"), "# integration\n");
        await sh(ctx.ws.integration.path, ctx.env, "commit", "-q", "-am", "readme");
        await writeFile(join(api, "README.md"), "# api\n");
        await sh(api, ctx.env, "commit", "-q", "-am", "readme");
        const head = await ctx.git.headSha(api);
        const conflict = await ctx.kit.syncRoleBranch.execute({
          roleWorktree: api,
          integrationBranch: ctx.ws.integration.branch,
        });
        expect(conflict).toEqual({ ok: false, conflicts: ["README.md"] });
        expect(await ctx.git.headSha(api)).toBe(head);
        expect(await ctx.git.isClean(api)).toBe(true);
      });
    },
    T,
  );
});

describe("FreezeContract", () => {
  test(
    "records the integration head that holds the contract",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await prepared(tmp);
        await finishTask(ctx, "backend", "api-1", { "apps/api/openapi.yaml": "openapi: 3.1.0\n" });
        await ctx.kit.mergeQueue.enqueue(job(ctx, "backend", "api-1"));
        const head = await ctx.git.headSha(ctx.ws.integration.path);
        const r = await ctx.kit.freezeContract.execute({
          squadId: SQ,
          projectId: P,
          path: "apps/api/openapi.yaml",
          version: 1,
        });
        expect(r).toEqual({ sha: head! });
        expect(eventsOf(ctx.store, "contract.frozen")).toMatchObject([
          {
            key: keys.contractFrozen(SQ, "apps/api/openapi.yaml", 1),
            data: { squadId: SQ, path: "apps/api/openapi.yaml", version: 1, sha: head },
          },
        ]);
        await expect(
          ctx.kit.freezeContract.execute({
            squadId: SQ,
            projectId: P,
            path: "apps/web/types.ts",
            version: 1,
          }),
        ).rejects.toMatchObject({ reason: "missing-contract" });
      });
    },
    T,
  );
});

describe("DeliverSquad", () => {
  async function built(tmp: string) {
    const ctx = await prepared(tmp);
    await finishTask(ctx, "backend", "api-1", { "apps/api/server.ts": "server\n" });
    await ctx.kit.mergeQueue.enqueue(job(ctx, "backend", "api-1"));
    const params = {
      squadId: SQ,
      projectId: P,
      repo: ctx.repo,
      baseBranch: "main",
      integrationBranch: ctx.ws.integration.branch,
      title: "Build the demo",
      body: "An API and a web app.",
    };
    return { ...ctx, params };
  }

  test(
    "branch mode leaves the integration branch for the user",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await built(tmp);
        const head = await ctx.git.headSha(ctx.repo);
        const r = await ctx.kit.deliver.execute({ ...ctx.params, mode: "branch" });
        expect(r).toEqual({ delivered: true, ref: ctx.ws.integration.branch });
        expect(await ctx.git.headSha(ctx.repo)).toBe(head);
        expect(eventsOf(ctx.store, "squad.delivered")).toMatchObject([
          {
            key: keys.squadDelivered(SQ),
            data: { squadId: SQ, mode: "branch", ref: ctx.ws.integration.branch },
          },
        ]);
      });
    },
    T,
  );

  test(
    "merge mode merges into the user's clean, checked-out base branch",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await built(tmp);
        const r = await ctx.kit.deliver.execute({ ...ctx.params, mode: "merge" });
        expect(r).toEqual({ delivered: true, ref: "main" });
        expect(await sh(ctx.repo, ctx.env, "log", "-1", "--format=%an|%s")).toBe(
          "Gravita|Gravita squad: Build the demo",
        );
        expect(existsSync(join(ctx.repo, "apps/api/server.ts"))).toBe(true);
        expect(await ctx.git.isClean(ctx.repo)).toBe(true);
      });
    },
    T,
  );

  test(
    "merge mode is refused on a dirty checkout or another branch",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await built(tmp);
        const head = await ctx.git.headSha(ctx.repo);
        await writeFile(join(ctx.repo, "wip.txt"), "mine");
        await expect(
          ctx.kit.deliver.execute({ ...ctx.params, mode: "merge" }),
        ).rejects.toBeInstanceOf(DirtyWorktreeError);
        await sh(ctx.repo, ctx.env, "switch", "-q", "-c", "elsewhere");
        await expect(
          ctx.kit.deliver.execute({ ...ctx.params, mode: "merge" }),
        ).rejects.toMatchObject({ reason: "wrong-branch" });
        expect(await ctx.git.headSha(ctx.repo, "refs/heads/main")).toBe(head);
        expect(eventsOf(ctx.store, "squad.delivered")).toEqual([]);
      });
    },
    T,
  );

  test(
    "pr mode needs a remote and gh; with both it pushes and opens the pull request",
    async () => {
      await withTempDir(async (tmp) => {
        const ctx = await built(tmp);
        const unavailable = (why: "not-installed" | "not-logged-in" | null): PullRequestHost => ({
          unavailable: async () => why,
          create: async () => "https://example.invalid/never",
        });
        const deliver = (host: PullRequestHost) =>
          new DeliverSquad({
            git: ctx.kit.git,
            pullRequests: host,
            ingest: ctx.ingest,
            clock: ctx.clock,
          });

        await expect(
          deliver(unavailable(null)).execute({ ...ctx.params, mode: "pr" }),
        ).rejects.toMatchObject({ reason: "no-remote" });

        const origin = join(tmp, "origin.git");
        await sh(tmp, ctx.env, "init", "-q", "--bare", origin);
        await sh(ctx.repo, ctx.env, "remote", "add", "origin", origin);
        await expect(
          deliver(unavailable("not-installed")).execute({ ...ctx.params, mode: "pr" }),
        ).rejects.toBeInstanceOf(GhUnavailableError);

        // A fake gh: answers --version and auth status, and prints a url for pr create.
        const fakeGh = join(tmp, "fake-gh");
        await writeFile(
          fakeGh,
          `#!/bin/sh\nif [ "$1" = "pr" ]; then printf '%s\\n' "$@" > "${join(tmp, "gh-args")}"; echo "Creating pull request"; echo "https://github.com/acme/demo/pull/7"; fi\nexit 0\n`,
          { mode: 0o755 },
        );
        const r = await deliver(new GhCli({ gh: fakeGh, env: ctx.env })).execute({
          ...ctx.params,
          mode: "pr",
        });
        expect(r).toEqual({ delivered: true, ref: "https://github.com/acme/demo/pull/7" });
        expect(await sh(origin, ctx.env, "rev-parse", ctx.ws.integration.branch)).toBe(
          (await ctx.git.headSha(ctx.ws.integration.path))!,
        );
        expect((await readFile(join(tmp, "gh-args"), "utf8")).split("\n")).toEqual([
          "pr",
          "create",
          "--base",
          "main",
          "--head",
          ctx.ws.integration.branch,
          "--title",
          "Build the demo",
          "--body",
          "An API and a web app.",
          "",
        ]);
        expect(eventsOf(ctx.store, "squad.delivered")).toMatchObject([
          { data: { mode: "pr", ref: "https://github.com/acme/demo/pull/7" } },
        ]);
      });
    },
    T,
  );

  test("GhCli reports a missing gh", async () => {
    expect(await new GhCli({ gh: "/nonexistent/gh" }).unavailable()).toBe("not-installed");
  });
});
