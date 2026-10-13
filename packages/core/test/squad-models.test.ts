import { describe, expect, test } from "bun:test";
import type { GravitaEvent, PlanTask, SquadModels } from "@gravita/protocol";
import { keys } from "@gravita/protocol/ids";
import {
  AUTO_MODELS,
  applyAll,
  emptyState,
  estimatePlanCost,
  isHighLeverage,
  MODEL_CHOICES,
  modelChoice,
  type PickModelInput,
  pickModel,
  squadTaskModel,
  taskEscalations,
} from "../src";
import { samplePlan } from "./squad-fixture";

const plan = samplePlan();
const task = (patch: Partial<PlanTask> = {}): PlanTask => ({
  id: "t",
  role: "backend",
  title: "T",
  plainSummary: "T",
  dependsOn: [],
  writes: ["apps/api/src/x.ts"],
  acceptance: ["ok"],
  size: "m",
  ...patch,
});

const FIXED_OPUS = MODEL_CHOICES.opus;
const FIXED_SONNET = MODEL_CHOICES.sonnet;
const OLD: SquadModels = { planner: "opus", roles: "opus" };

describe("pickModel", () => {
  const cases: [string, Omit<PickModelInput, "plan">, string][] = [
    ["auto: the briefing runs on Sonnet", { models: AUTO_MODELS, phase: "briefing" }, "sonnet"],
    ["auto: planning runs on Opus", { models: AUTO_MODELS, phase: "planning" }, "opus"],
    [
      "auto: a small task on Sonnet",
      { models: AUTO_MODELS, phase: "task", task: task({ size: "s" }) },
      "sonnet",
    ],
    [
      "auto: a medium task on Sonnet",
      { models: AUTO_MODELS, phase: "task", task: task() },
      "sonnet",
    ],
    [
      "auto: a large task on Opus",
      { models: AUTO_MODELS, phase: "task", task: task({ size: "l" }) },
      "opus",
    ],
    [
      "auto: a foundation task on Opus",
      { models: AUTO_MODELS, phase: "task", task: task({ size: "s", foundation: true }) },
      "opus",
    ],
    [
      "auto: a task writing a contract on Opus",
      { models: AUTO_MODELS, phase: "task", task: task({ writes: ["apps/api/openapi.yaml"] }) },
      "opus",
    ],
    [
      "auto: a task writing a folder holding a contract on Opus",
      { models: AUTO_MODELS, phase: "task", task: task({ writes: ["apps/api/"] }) },
      "opus",
    ],
    [
      "auto: one escalation moves Sonnet to Opus",
      { models: AUTO_MODELS, phase: "task", task: task(), escalations: 1 },
      "opus",
    ],
    [
      "auto: Opus stays Opus",
      { models: AUTO_MODELS, phase: "task", task: task({ size: "l" }), escalations: 3 },
      "opus",
    ],
    [
      "auto: Haiku roles step to Sonnet",
      { models: { ...AUTO_MODELS, roles: "haiku" }, phase: "task", task: task(), escalations: 1 },
      "sonnet",
    ],
    [
      "auto: Haiku roles step twice to Opus",
      {
        models: { ...AUTO_MODELS, roles: "haiku" },
        phase: "task",
        task: task({ foundation: true }),
        escalations: 1,
      },
      "opus",
    ],
    [
      "auto: a full model id is kept when nothing steps",
      { models: { ...AUTO_MODELS, roles: "claude-sonnet-5-5" }, phase: "task", task: task() },
      "claude-sonnet-5-5",
    ],
    [
      "auto: a briefing model given wins",
      { models: { ...AUTO_MODELS, briefing: "haiku" }, phase: "briefing" },
      "haiku",
    ],
    [
      "auto without a briefing model: Sonnet",
      { models: { mode: "auto", planner: "opus", roles: "sonnet" }, phase: "briefing" },
      "sonnet",
    ],
    ["Opus everywhere: briefing", { models: FIXED_OPUS, phase: "briefing" }, "opus"],
    [
      "Opus everywhere: a small task",
      { models: FIXED_OPUS, phase: "task", task: task({ size: "s" }) },
      "opus",
    ],
    ["Sonnet everywhere: planning", { models: FIXED_SONNET, phase: "planning" }, "sonnet"],
    [
      "Sonnet everywhere: a foundation task",
      { models: FIXED_SONNET, phase: "task", task: task({ foundation: true }) },
      "sonnet",
    ],
    [
      "Sonnet everywhere: never escalates",
      { models: FIXED_SONNET, phase: "task", task: task(), escalations: 2 },
      "sonnet",
    ],
    [
      "old squads (no mode): briefing on the planner model",
      { models: { planner: "opus", roles: "sonnet" }, phase: "briefing" },
      "opus",
    ],
    [
      "old squads (no mode): tasks on the roles model",
      {
        models: { planner: "opus", roles: "sonnet" },
        phase: "task",
        task: task({ size: "l" }),
        escalations: 1,
      },
      "sonnet",
    ],
  ];
  for (const [name, input, want] of cases)
    test(name, () => expect(pickModel({ ...input, plan })).toBe(want));

  test("a plan role's own model wins over the policy, escalations included", () => {
    const p = structuredClone(plan);
    const backend = p.roles.find((r) => r.id === "backend");
    if (backend) backend.model = "haiku";
    const big = task({ size: "l", foundation: true });
    expect(
      pickModel({ models: AUTO_MODELS, phase: "task", plan: p, task: big, escalations: 2 }),
    ).toBe("haiku");
    expect(pickModel({ models: FIXED_OPUS, phase: "task", plan: p, task: big })).toBe("haiku");
  });

  test("a reassigned task runs as its new role", () => {
    const p = structuredClone(plan);
    const frontend = p.roles.find((r) => r.id === "frontend");
    if (frontend) frontend.model = "haiku";
    expect(
      pickModel({ models: AUTO_MODELS, phase: "task", plan: p, task: task(), roleId: "frontend" }),
    ).toBe("haiku");
  });

  test("high leverage: foundation, a contract path either way round, or large", () => {
    expect(isHighLeverage(plan, task({ foundation: true }))).toBe(true);
    expect(isHighLeverage(plan, task({ size: "l" }))).toBe(true);
    expect(isHighLeverage(plan, task({ writes: ["apps/api/openapi.yaml"] }))).toBe(true);
    expect(isHighLeverage(plan, task({ writes: ["apps/api"] }))).toBe(true);
    expect(isHighLeverage(plan, task({ writes: ["apps/api-gateway/x.ts"] }))).toBe(false);
    expect(isHighLeverage(plan, task())).toBe(false);
  });
});

describe("modelChoice", () => {
  test("names the three choices, and older squads by what they ran", () => {
    expect(modelChoice(AUTO_MODELS)).toBe("auto");
    expect(modelChoice(FIXED_OPUS)).toBe("opus");
    expect(modelChoice(FIXED_SONNET)).toBe("sonnet");
    expect(modelChoice(OLD)).toBe("opus");
    expect(modelChoice({ planner: "opus", roles: "sonnet" })).toBeUndefined();
    expect(modelChoice({ planner: "haiku", roles: "haiku" })).toBeUndefined();
  });
});

describe("escalations from the projection", () => {
  const Q = "q1";
  const ts = (n: number) => `2026-10-13T10:00:${String(n).padStart(2, "0")}.000Z`;
  const ev = (n: number, key: string, e: Pick<GravitaEvent, "type" | "data">) =>
    ({
      source: "gravita",
      provider: "gravita",
      projectId: "p",
      key,
      ts: ts(n),
      ...e,
    }) as GravitaEvent;
  const status = (
    n: number,
    s: "running" | "ready" | "blocked" | "failed",
    attempt: number,
    struggledAttempt?: number,
  ) =>
    ev(n, keys.taskStatus(Q, "api-todos", attempt, s), {
      type: "task.status_changed",
      data: {
        squadId: Q,
        taskId: "api-todos",
        role: "backend",
        status: s,
        attempt,
        ...(struggledAttempt ? { struggledAttempt } : {}),
      },
    });
  const base = [
    ev(0, keys.squadCreated(Q), {
      type: "squad.created",
      data: {
        squadId: Q,
        cwd: "/w",
        brief: "b",
        models: AUTO_MODELS,
        budgetUsd: 20,
        autonomy: "guarded",
      },
    }),
    ev(1, keys.planApproved(Q), { type: "plan.approved", data: { squadId: Q, plan } }),
  ];
  const squad = (events: GravitaEvent[]) => {
    const state = emptyState();
    applyAll(state, events);
    const q = state.squads?.[Q];
    if (!q) throw new Error("no squad");
    return q;
  };

  test("each attempt that struggled counts once, whatever order the statuses land in", () => {
    const events = [
      ...base,
      status(2, "running", 1),
      // A conflict: Gravita retried on its own.
      status(3, "ready", 2, 1),
      status(4, "running", 2),
      // A red check after the retry: the task waits for the user.
      status(5, "blocked", 2, 2),
    ];
    const q = squad(events);
    expect(q.tasks["api-todos"]?.struggled).toEqual([1, 2]);
    expect(taskEscalations(q, "api-todos")).toBe(2);
    expect(squadTaskModel(q, plan, "api-todos")).toBe("opus");
    // Replayed, or out of order: the same count.
    const shuffled = squad([
      ...base,
      status(5, "blocked", 2, 2),
      status(3, "ready", 2, 1),
      status(5, "blocked", 2, 2),
    ]);
    expect(shuffled.tasks["api-todos"]?.struggled).toEqual([1, 2]);
  });

  test("an interruption or a fresh start doesn't escalate", () => {
    const q = squad([
      ...base,
      status(2, "running", 1),
      status(3, "ready", 2),
      status(4, "running", 2),
    ]);
    expect(taskEscalations(q, "api-todos")).toBe(0);
    expect(squadTaskModel(q, plan, "api-todos")).toBe("sonnet");
    expect(squadTaskModel(q, plan, "web-list")).toBe("opus");
    expect(squadTaskModel(q, plan, "nope")).toBeUndefined();
  });
});

describe("estimatePlanCost under the policy", () => {
  test("Automatic sits between Sonnet everywhere and Opus everywhere", () => {
    const auto = estimatePlanCost(plan, AUTO_MODELS).totalUsd;
    expect(auto).toBeGreaterThan(estimatePlanCost(plan, FIXED_SONNET).totalUsd);
    expect(auto).toBeLessThan(estimatePlanCost(plan, FIXED_OPUS).totalUsd);
  });

  test("says which model each task runs on, and splits the spend by model", () => {
    const e = estimatePlanCost(plan, AUTO_MODELS);
    expect(e.taskModels).toEqual({
      "api-contract": "opus",
      "api-todos": "sonnet",
      "web-list": "opus",
    });
    const byModel = Object.values(e.byModel).reduce((a, b) => a + b, 0);
    expect(byModel).toBeCloseTo(e.totalUsd, 9);
    expect(e.byModel.sonnet).toBeCloseTo(e.byTask["api-todos"] ?? 0, 9);
    expect(e.byModel.haiku).toBeUndefined();
    expect(e.byModel.opus).toBeCloseTo(
      e.plannerUsd + (e.byTask["api-contract"] ?? 0) + (e.byTask["web-list"] ?? 0),
      9,
    );
  });

  test("an override prices that task at its model", () => {
    const e = estimatePlanCost(plan, AUTO_MODELS, { "api-todos": "opus" });
    expect(e.taskModels["api-todos"]).toBe("opus");
    expect(e.byTask["api-todos"]).toBeGreaterThan(
      estimatePlanCost(plan, AUTO_MODELS).byTask["api-todos"] ?? 0,
    );
  });
});
