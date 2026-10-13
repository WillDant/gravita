import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AUTO_MODELS, validatePlan } from "@gravita/core";
import type { SquadModels, SquadPlan } from "@gravita/protocol";
import type { SquadEmitter, TaskStatusFact } from "../../src/application/squad/squad-emitter";
import { type LiveAttempt, SquadRun } from "../../src/application/squad/squad-run";
import { SquadScheduler } from "../../src/application/squad/squad-scheduler";
import type { AttemptEnd } from "../../src/application/squad/task-runner";
import { squadLayout } from "../../src/domain/squad-workspace";
import { testPlan } from "../git-helpers";
import { withTempDir } from "../helpers";
import { createAndPlan, type ScriptedAgent, squadCore, until } from "../squad-fakes";

// The model policy, end to end with scripted sessions: which model each session gets under
// Automatic, under the fixed choices, and for squads made before the policy.

/** Foundation, contract, large, medium and small tasks, for one look at the policy. */
function policyPlan(): SquadPlan {
  return testPlan({
    contracts: [{ path: "apps/api/openapi.yaml", owner: "backend", kind: "openapi" }],
    tasks: [
      {
        id: "contract",
        role: "backend",
        title: "The contract",
        plainSummary: "Agrees on the API.",
        dependsOn: [],
        writes: ["apps/api/openapi.yaml"],
        acceptance: ["it exists"],
        size: "s",
        foundation: true,
      },
      {
        id: "api-big",
        role: "backend",
        title: "The API",
        plainSummary: "The server.",
        dependsOn: ["contract"],
        writes: ["apps/api/src/"],
        acceptance: ["it answers"],
        size: "l",
      },
      {
        id: "api-spec",
        role: "backend",
        title: "Spec notes",
        plainSummary: "Notes next to the contract.",
        dependsOn: ["api-big"],
        writes: ["apps/api/"],
        acceptance: ["they exist"],
        size: "m",
      },
      {
        id: "web-mid",
        role: "frontend",
        title: "The page",
        plainSummary: "The page.",
        dependsOn: ["contract"],
        writes: ["apps/web/"],
        acceptance: ["it shows"],
        size: "m",
      },
      {
        id: "web-small",
        role: "frontend",
        title: "A button",
        plainSummary: "A button.",
        dependsOn: ["web-mid"],
        writes: ["apps/web/button/"],
        acceptance: ["it clicks"],
        size: "s",
      },
    ],
  });
}

/** Writes a file inside the task's first path and completes it. */
async function work(a: ScriptedAgent) {
  const taskId = await a.taskId();
  const file =
    taskId === "contract"
      ? "apps/api/openapi.yaml"
      : `${taskId.startsWith("api") ? "apps/api/src" : "apps/web"}/${taskId}.ts`;
  await a.write({ [file]: `// ${taskId}\n` });
  const done = await a.tool("complete_task", { summary: "Done." });
  if (done.isError) throw new Error(done.text);
  a.result({ cost: 0.1 });
}

/** Runs `plan` to the end with `models`; the model of each task's session, by task. */
async function runSquad(tmp: string, plan: SquadPlan, models?: SquadModels) {
  const byTask: Record<string, string | undefined> = {};
  const h = squadCore(tmp, async (a) => {
    if (a.isBriefing) return;
    if (a.isPlanner) return a.result({ structured: plan, cost: 0.1 });
    byTask[await a.taskId()] = a.options.model;
    await work(a);
  });
  const cwd = join(tmp, "app");
  await mkdir(cwd, { recursive: true });
  const { squadId } = await createAndPlan(h, {
    cwd,
    brief: "Demo",
    budgetUsd: 20,
    autonomy: "guarded",
    ...(models ? { models } : {}),
  });
  await h.squads.approvePlan({ squadId, plan: h.squad(squadId).plan as SquadPlan });
  await until(() => h.squad(squadId).phase === "deliver", "delivery");
  await h.squads.idle(squadId);
  expect(h.failures).toEqual([]);
  return { h, squadId, byTask };
}

describe("Automatic", () => {
  test("the briefing talks on Sonnet, the planner resumes it on Opus, subagents run on Haiku", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async (a) => {
        if (a.isBriefing) {
          await a.prompt(1);
          return a.result({ cost: 0.1 });
        }
        a.result({ structured: testPlan() });
      });
      const cwd = join(tmp, "app");
      await mkdir(cwd, { recursive: true });
      const { squadId } = await h.squads.create({
        cwd,
        brief: "A todo app",
        budgetUsd: 30,
        autonomy: "guarded",
      });
      await until(() => h.squad(squadId).budget.spentUsd > 0, "the briefing's answer");
      h.squads.plan({ squadId });
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);
      expect(h.squad(squadId).models).toEqual(AUTO_MODELS);

      const [briefing, planner] = h.agents as [ScriptedAgent, ScriptedAgent];
      expect(briefing.options.model).toBe("sonnet");
      expect(planner.isPlanner).toBe(true);
      // The same session, continued on a stronger model.
      expect(planner.options.resume).toBe(briefing.options.sessionId as string);
      expect(planner.options.model).toBe("opus");
      for (const a of [briefing, planner])
        expect(a.options.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBe("haiku");
      // One session: it started on Sonnet, and the switch to Opus is recorded on it.
      const sessionId = briefing.options.sessionId as string;
      expect(h.events("session.started").map((e) => (e.data as { model?: string }).model)).toEqual([
        "sonnet",
      ]);
      expect(h.core.projection.session(sessionId)?.model).toBe("opus");
    });
  });

  test("small and medium tasks run on Sonnet; foundation, contract and large tasks on Opus", async () => {
    await withTempDir(async (tmp) => {
      const plan = policyPlan();
      expect(validatePlan(plan)).toEqual([]);
      const { h, byTask } = await runSquad(tmp, plan);
      expect(byTask).toEqual({
        contract: "opus",
        "api-big": "opus",
        "api-spec": "opus",
        "web-mid": "sonnet",
        "web-small": "sonnet",
      });
      for (const a of h.agents.filter((x) => x.isRole)) {
        expect(a.options.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBe("haiku");
        expect(a.options.env?.CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS).toBe("4");
      }
    });
  });
});

describe("fixed models", () => {
  test("Sonnet everywhere runs every session on Sonnet and leaves subagents alone", async () => {
    await withTempDir(async (tmp) => {
      const models: SquadModels = { mode: "fixed", planner: "sonnet", roles: "sonnet" };
      const { h, squadId, byTask } = await runSquad(tmp, policyPlan(), models);
      expect(new Set(Object.values(byTask))).toEqual(new Set(["sonnet"]));
      expect(h.agents.map((a) => a.options.model)).toEqual(h.agents.map(() => "sonnet"));
      for (const a of h.agents) expect(a.options.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
      expect(h.squad(squadId).models.mode).toBe("fixed");
    });
  });

  test("a client that sends planner and roles only (before the policy) gets exactly those", async () => {
    await withTempDir(async (tmp) => {
      const { h, squadId, byTask } = await runSquad(tmp, policyPlan(), {
        planner: "opus",
        roles: "opus",
      });
      expect(h.squad(squadId).models).toEqual({ mode: "fixed", planner: "opus", roles: "opus" });
      // The briefing (none here: the plan was asked for at once) and the planner on Opus.
      expect(h.agents.filter((a) => !a.isRole).map((a) => a.options.model)).toEqual([
        "opus",
        "opus",
      ]);
      expect(new Set(Object.values(byTask))).toEqual(new Set(["opus"]));
      for (const a of h.agents) expect(a.options.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
    });
  });

  test("a plan role's own model wins over the policy", async () => {
    await withTempDir(async (tmp) => {
      const plan = policyPlan();
      const backend = plan.roles.find((r) => r.id === "backend");
      if (backend) backend.model = "haiku";
      const { byTask } = await runSquad(tmp, plan);
      expect(byTask).toMatchObject({ contract: "haiku", "api-big": "haiku", "web-mid": "sonnet" });
    });
  });
});

describe("what escalates", () => {
  /** The status `settle` records for an attempt that ended as `end`. */
  function settled(end: AttemptEnd): TaskStatusFact[] {
    const facts: TaskStatusFact[] = [];
    const emitter = {
      taskStatus: (_q: unknown, f: TaskStatusFact) => facts.push(f),
      budget: () => {},
      paused: () => {},
      changeRequestResolved: () => {},
    } as unknown as SquadEmitter;
    const scheduler = new SquadScheduler({
      squads: { squad: () => undefined, squads: () => [] },
      emitter,
    } as never);
    const run = new SquadRun("q1", "p1", squadLayout("/data", "p1", "q1"));
    const live: LiveAttempt = {
      squadId: "q1",
      projectId: "p1",
      roleId: "backend",
      taskId: "api-1",
      attempt: 2,
      worktree: "/w",
      roleBranch: "b",
      integrationBranch: "i",
      model: "sonnet",
      maxBudgetUsd: 1,
      bounces: 0,
      progressCount: 0,
    };
    scheduler.settle(run, live, end);
    return facts;
  }

  const cases: [string, AttemptEnd, boolean][] = [
    ["a merge conflict", { kind: "conflicted", paths: ["a.ts"] }, true],
    [
      "a red check that reverted the merge",
      { kind: "reverted", checkId: "c", output: "red" },
      true,
    ],
    ["a failure (complete_task sent back too often)", { kind: "failed", reason: "x" }, true],
    ["an error", { kind: "error", message: "boom" }, true],
    ["ending twice without finishing", { kind: "incomplete" }, true],
    ["running out of turns", { kind: "max-turns" }, true],
    ["a question for the user", { kind: "yielded", reason: "which?" }, false],
    ["a spent budget", { kind: "budget", usedUsd: 1, limitUsd: 1 }, false],
    ["an interruption", { kind: "interrupted", sessionId: "s" }, false],
    ["the kill switch", { kind: "killed", sessionId: "s" }, false],
    ["success", { kind: "merged", sha: "abc" }, false],
  ];
  for (const [name, end, escalates] of cases)
    test(`${name}: ${escalates ? "the next run steps up" : "no step up"}`, () => {
      const [fact] = settled(end);
      if (escalates) expect(fact?.struggledAttempt).toBe(2);
      else expect(fact?.struggledAttempt).toBeUndefined();
    });
});
