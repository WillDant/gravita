import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { squadPlanJsonSchema } from "@gravita/protocol";
import { PLANNER_CHARTER } from "../../src/application/squad/prompts";
import { judgePlan } from "../../src/application/squad/run-planner";
import { DirtyWorktreeError } from "../../src/domain/errors";
import { BASE_FILES, testPlan, userRepo, writeFiles } from "../git-helpers";
import { withTempDir } from "../helpers";
import { type ScriptedAgent, squadCore } from "../squad-fakes";

const overlapping = () => {
  const p = testPlan();
  return {
    ...p,
    roles: p.roles.map((r) => (r.id === "frontend" ? { ...r, owns: ["apps/"] } : r)),
  };
};

async function emptyFolder(tmp: string) {
  const cwd = join(tmp, "todo");
  await mkdir(cwd, { recursive: true });
  return cwd;
}

const create = (cwd: string) => ({
  cwd,
  brief: "A todo app",
  budgetUsd: 30,
  autonomy: "guarded" as const,
});

describe("planner", () => {
  test("an invalid plan is rejected with the validator's words, fixed in the same session, then proposed", async () => {
    await withTempDir(async (tmp) => {
      const prompts: string[] = [];
      const h = squadCore(tmp, async (a: ScriptedAgent) => {
        prompts.push(await a.prompt(1));
        a.result({ structured: overlapping(), cost: 0.2 });
        prompts.push(await a.prompt(2));
        a.result({ structured: testPlan(), cost: 0.5 });
      });
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);

      const q = h.squad(squadId);
      expect(q.phase).toBe("review");
      expect(q.planStatus).toBe("proposed");
      expect(q.planAttempts).toBe(2);
      expect(q.models).toEqual({ planner: "opus", roles: "opus" });
      expect(q.baseBranch).toBe("main");
      const rejected = h.events("plan.rejected")[0];
      expect(rejected?.data).toMatchObject({ attempt: 1 });
      const errors = (rejected?.data as { errors: string[] } | undefined)?.errors ?? [];
      expect(errors[0]).toContain('Roles "backend" and "frontend" overlap');
      // The errors went back to the planner as its next message.
      expect(prompts[1]).toContain(errors[0] as string);
      expect(prompts[0]).toContain("A todo app");
      expect(
        h
          .events()
          .map((e) => e.type)
          .filter((t) => t.startsWith("plan") || t.startsWith("squad")),
      ).toEqual([
        "squad.created",
        "squad.phase_changed",
        "plan.rejected",
        "plan.proposed",
        "squad.phase_changed",
      ]);
      // One planner session, read-only, and its spend counts for the squad.
      expect(h.agents).toHaveLength(1);
      expect(q.budget.spentUsd).toBeCloseTo(0.5);
      expect(h.agents[0]?.q.closed).toBe(true);
    });
  });

  test("the planner session is read-only, structured and on Opus", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async (a) => a.result({ structured: testPlan() }));
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      await h.squads.idle(squadId);
      const o = h.agents[0]?.options;
      expect(o).toMatchObject({
        tools: ["Read", "Grep", "Glob"],
        disallowedTools: ["Write", "Edit", "NotebookEdit", "Bash", "MultiEdit"],
        permissionMode: "dontAsk",
        outputFormat: { type: "json_schema", schema: squadPlanJsonSchema() },
        model: "opus",
        maxTurns: 30,
        // A tenth of $30, and at least $1.
        maxBudgetUsd: 3,
        systemPrompt: { type: "preset", preset: "claude_code", append: PLANNER_CHARTER },
      });
      expect(o?.mcpServers).toBeUndefined();
      expect(o?.hooks).toBeUndefined();
      // It never asks the user: anything but reading is denied.
      const canUseTool = o?.canUseTool;
      const ask = (tool: string) =>
        canUseTool?.(
          tool,
          {},
          { signal: new AbortController().signal, toolUseID: "t", requestId: "r" },
        );
      expect(await ask("Bash")).toMatchObject({ behavior: "deny" });
      expect(await ask("Read")).toMatchObject({ behavior: "allow" });
      // The session belongs to the squad, not to the chat limit.
      const started = h.events("session.started")[0];
      expect(started?.data).toMatchObject({ kind: "squad", squadId, cwd: join(tmp, "todo") });
    });
  });

  test("three invalid plans fail the squad with the reason", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async (a) => {
        for (let n = 1; n <= 3; n++) {
          await a.prompt(n);
          a.result({ structured: n === 2 ? { goal: "not a plan" } : overlapping() });
        }
      });
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      await h.squads.idle(squadId);
      const q = h.squad(squadId);
      expect(q.phase).toBe("failed");
      expect(q.phaseReason).toContain("couldn't produce a valid plan in 3 tries");
      expect(h.events("plan.rejected").map((e) => (e.data as { attempt: number }).attempt)).toEqual(
        [1, 2, 3],
      );
      expect(h.events("plan.proposed")).toHaveLength(0);
    });
  });

  test("replan runs the planner again with the user's feedback", async () => {
    await withTempDir(async (tmp) => {
      const prompts: string[] = [];
      const h = squadCore(tmp, async (a) => {
        prompts.push(await a.prompt(1));
        a.result({ structured: testPlan() });
      });
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      await h.squads.idle(squadId);
      await h.squads.replan({ squadId, feedback: "Split the web app into two tasks" });
      await h.squads.idle(squadId);
      expect(prompts[1]).toContain("Split the web app into two tasks");
      expect(h.squad(squadId)).toMatchObject({ phase: "review", planAttempts: 2 });
    });
  });

  test("a folder with files that isn't a repository, or a dirty repository, is refused before any spend", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async () => {});
      const loose = join(tmp, "loose");
      await writeFiles(loose, { "a.txt": "x" });
      await expect(h.squads.create(create(loose))).rejects.toThrow("isn't a git repository");
      await expect(h.squads.create(create(join(tmp, "missing")))).rejects.toThrow("doesn't exist");
      const repo = join(tmp, "repo");
      await userRepo(repo, h.env, BASE_FILES);
      await writeFiles(repo, { "scratch.txt": "wip" });
      await expect(h.squads.create(create(repo))).rejects.toBeInstanceOf(DirtyWorktreeError);
      expect(h.agents).toHaveLength(0);
      expect(h.events("squad.created")).toHaveLength(0);
    });
  });

  test("judgePlan: shape problems name the field, meaning problems use the validator", () => {
    expect(judgePlan(undefined).errors[0]).toContain("structured output");
    expect(judgePlan({ goal: "x" }).errors.some((e) => e.startsWith("summary:"))).toBe(true);
    expect(judgePlan(testPlan())).toEqual({ plan: testPlan(), errors: [] });
  });
});
