import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createCore } from "../../src/main/container";
import { FakeClock, SilentLogger } from "../fakes";
import { isolatedEnv, sh, testPlan, writeFiles } from "../git-helpers";
import { withTempDir } from "../helpers";

// docs/COMPLIANCE.md for squads: a whole prepare → commit → merge → deliver run writes only
// to the user's repository and to Gravita's worktrees root. Nothing lands under HOME (so
// nothing under ~/.claude, and no git config), nothing anywhere else.

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    out.push(path);
    if (entry.isDirectory()) await walk(path, out);
  }
  return out;
}

describe("squad compliance", () => {
  test("a full squad run touches only the repo and the worktrees root, never HOME", async () => {
    await withTempDir(async (tmp) => {
      const home = join(tmp, "home");
      await mkdir(home);
      const env = isolatedEnv(home);
      const project = join(tmp, "project");
      await mkdir(project);
      const worktreesRoot = join(tmp, "data", "worktrees");
      const core = createCore({
        dbPath: ":memory:",
        demo: false,
        clock: new FakeClock(),
        logger: new SilentLogger(),
        squad: { worktreesRoot, env, checkEnv: () => env },
      });
      try {
        const kit = core.squad!;
        const plan = testPlan({
          checks: [{ id: "green", argv: ["node", "-e", "1"], cwd: ".", when: "integration" }],
        });
        const ids = { squadId: "sq1", projectId: "p1" };
        const ws = await kit.prepare.execute({ ...ids, cwd: project, plan });
        for (const [roleId, taskId, file] of [
          ["backend", "api-1", "apps/api/server.ts"],
          ["frontend", "web-1", "apps/web/page.ts"],
        ] as const) {
          const worktree = ws.roles[roleId]!.path;
          await writeFiles(worktree, { [file]: "export {};\n" });
          const c = await kit.commitTask.execute({
            ...ids,
            plan,
            roleId,
            taskId,
            attempt: 1,
            worktree,
            base: ws.integration.branch,
          });
          expect(c.ok).toBe(true);
          const m = await kit.mergeQueue.enqueue({
            ...ids,
            plan,
            roleId,
            taskId,
            attempt: 1,
            roleBranch: ws.roles[roleId]!.branch,
          });
          expect(m.status).toBe("merged");
        }
        const d = await kit.deliver.execute({
          ...ids,
          mode: "merge",
          repo: ws.repo,
          baseBranch: ws.baseBranch,
          integrationBranch: ws.integration.branch,
          title: plan.goal,
          body: plan.summary,
        });
        expect(d).toEqual({ delivered: true, ref: "main" });
        expect(await sh(project, env, "ls-files")).toContain("apps/web/page.ts");
        expect([...core.events.allEvents()].map((e) => e.type)).toEqual(
          expect.arrayContaining([
            "commit.created",
            "merge.started",
            "check.ran",
            "merge.succeeded",
            "squad.delivered",
          ]),
        );
        // The squad shows up in the projection, keyed by its id.
        expect(core.projection.snapshot().state.squads.sq1).toBeDefined();

        expect(existsSync(join(home, ".claude"))).toBe(false);
        expect(await readdir(home)).toEqual([]);
        expect((await readdir(tmp)).sort()).toEqual(["data", "home", "project"]);
        expect(await readdir(join(tmp, "data"))).toEqual(["worktrees"]);
        for (const path of await walk(tmp)) {
          const rel = relative(tmp, path);
          const allowed =
            rel === "home" ||
            rel === "project" ||
            rel.startsWith(`project/`) ||
            rel === "data" ||
            rel === "data/worktrees" ||
            rel.startsWith("data/worktrees/");
          expect({ rel, allowed }).toEqual({ rel, allowed: true });
        }

        await kit.cleanup.execute({ ...ids, repo: ws.repo, plan });
        expect(await readdir(join(worktreesRoot, "p1", "sq1"))).toEqual([]);
      } finally {
        core.close();
      }
    });
  }, 60_000);
});
