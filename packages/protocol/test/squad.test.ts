import { describe, expect, test } from "bun:test";
import { GravitaEvent } from "../src/events";
import { keys } from "../src/ids";
import { RpcContract } from "../src/rpc";
import { type SquadPlan as Plan, SquadPlan, squadPlanJsonSchema } from "../src/squad";

const plan: Plan = {
  goal: "A todo app",
  summary: "An API and a web UI for todos.",
  stack: ["hono", "react", "vitest"],
  roles: [
    {
      id: "backend",
      name: "Backend",
      kind: "backend",
      owns: ["apps/api/"],
      charter: "Own the API.",
    },
    {
      id: "frontend",
      name: "Frontend",
      kind: "frontend",
      owns: ["apps/web/"],
      charter: "Own the UI.",
    },
  ],
  shared: { paths: ["package.json", "pnpm-lock.yaml"], strategy: "regenerate" },
  contracts: [{ path: "apps/api/openapi.yaml", owner: "backend", kind: "openapi" }],
  tasks: [
    {
      id: "api-todos",
      role: "backend",
      title: "Todos API",
      plainSummary: "Lets the app save and list todos.",
      dependsOn: [],
      writes: ["apps/api/src/"],
      acceptance: ["GET /todos lists todos"],
      size: "m",
    },
  ],
  checks: [{ id: "api-test", argv: ["pnpm", "test"], cwd: "apps/api", when: "integration" }],
  assumptions: [],
  questions: [],
};

const base = {
  ts: "2026-10-13T00:00:00.000Z",
  source: "gravita",
  provider: "gravita",
  projectId: "p",
};

describe("SquadPlan", () => {
  test("a well-formed plan parses; a bad role id or an empty role list doesn't", () => {
    expect(SquadPlan.safeParse(plan).success).toBe(true);
    const badId = { ...plan, roles: [{ ...plan.roles[0]!, id: "Back End" }] };
    expect(SquadPlan.safeParse(badId).success).toBe(false);
    expect(SquadPlan.safeParse({ ...plan, roles: [] }).success).toBe(false);
  });

  test("its JSON Schema is draft-07, for the planner's structured output", () => {
    const schema = squadPlanJsonSchema();
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("tasks");
  });
});

describe("squad events", () => {
  test("squad facts validate as GravitaEvents and carry their squad in the data", () => {
    const events = [
      {
        ...base,
        key: keys.squadCreated("q1"),
        type: "squad.created",
        data: {
          squadId: "q1",
          cwd: "/r",
          brief: "Todo app",
          models: { planner: "opus", roles: "opus" },
          budgetUsd: 20,
          autonomy: "guarded",
        },
      },
      {
        ...base,
        key: keys.planProposed("q1", 1),
        type: "plan.proposed",
        data: { squadId: "q1", attempt: 1, plan },
      },
      {
        ...base,
        key: keys.taskStatus("q1", "api-todos", 1, "running"),
        type: "task.status_changed",
        data: {
          squadId: "q1",
          taskId: "api-todos",
          status: "running",
          attempt: 1,
          role: "backend",
        },
      },
      {
        ...base,
        key: keys.merge("q1", "api-todos", 1, "succeeded"),
        type: "merge.succeeded",
        data: { squadId: "q1", taskId: "api-todos", role: "backend", attempt: 1, sha: "abc" },
      },
      {
        ...base,
        key: keys.budget("q1", "squad", "q1", "warned"),
        type: "budget.warned",
        data: { squadId: "q1", scope: "squad", scopeId: "q1", usedUsd: 15, limitUsd: 20 },
      },
    ];
    for (const e of events) expect(GravitaEvent.safeParse(e).success).toBe(true);
    const noSquad = { ...events[0]!, data: { ...events[0]!.data, squadId: undefined } };
    expect(GravitaEvent.safeParse(noSquad).success).toBe(false);
  });

  test("keys name the fact and its attempt, so a replay stores nothing twice", () => {
    expect(keys.taskStatus("q", "t", 2, "done")).toBe("squad:q:task:t:2:done");
    expect(keys.taskStatus("q", "t", 1, "done")).not.toBe(keys.taskStatus("q", "t", 2, "done"));
    expect(keys.squadPhase("q", "build", 1)).not.toBe(keys.squadPhase("q", "build", 2));
  });

  test("squad.create and squad.approvePlan validate their params", () => {
    const create = RpcContract["squad.create"].params;
    expect(
      create.safeParse({ cwd: "/r", brief: "x", budgetUsd: 20, autonomy: "guarded" }).success,
    ).toBe(true);
    expect(
      create.safeParse({ cwd: "/r", brief: "x", budgetUsd: 0, autonomy: "guarded" }).success,
    ).toBe(false);
    const approve = RpcContract["squad.approvePlan"].params;
    expect(approve.safeParse({ squadId: "q", plan }).success).toBe(true);
  });
});
