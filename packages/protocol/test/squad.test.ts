import { describe, expect, test } from "bun:test";
import { GravitaEvent } from "../src/events";
import { keys } from "../src/ids";
import { RpcContract, RpcErrors } from "../src/rpc";
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

describe("plan budgets", () => {
  const create = RpcContract["squad.create"].params;
  const params = { cwd: "/r", brief: "x", autonomy: "guarded" };

  test("squad.create takes a share of a plan window, dollars, or the older budgetUsd", () => {
    const plan = { mode: "plan", maxPercent: 20, window: "seven_day" };
    expect(create.safeParse({ ...params, budget: plan }).success).toBe(true);
    expect(create.safeParse({ ...params, budget: { mode: "usd", amount: 25 } }).success).toBe(true);
    expect(create.safeParse({ ...params, budgetUsd: 25 }).success).toBe(true);
    // A share is 1–100 points of the 5-hour or weekly window, and a squad needs a budget.
    expect(create.safeParse({ ...params, budget: { ...plan, maxPercent: 0 } }).success).toBe(false);
    expect(create.safeParse({ ...params, budget: { ...plan, maxPercent: 101 } }).success).toBe(
      false,
    );
    expect(create.safeParse({ ...params, budget: { ...plan, window: "month" } }).success).toBe(
      false,
    );
    expect(create.safeParse(params).success).toBe(false);
  });

  test("squad.resume raises a share or dollars", () => {
    const resume = RpcContract["squad.resume"].params;
    expect(resume.safeParse({ squadId: "q", maxPercent: 30 }).success).toBe(true);
    expect(resume.safeParse({ squadId: "q", maxPercent: 120 }).success).toBe(false);
    expect(resume.safeParse({ squadId: "q", budgetUsd: 30 }).success).toBe(true);
  });

  test("usage.limits, budget levels in points, baselines and measures validate; old USD events still do", () => {
    const events = [
      {
        ...base,
        provider: "claude",
        key: keys.usageLimits("claude", "seven_day", undefined, "u1"),
        type: "usage.limits",
        data: {
          provider: "claude",
          window: "seven_day",
          usedPercent: 34,
          resetsAt: "2026-10-16T09:00:00.000Z",
          status: "allowed",
        },
      },
      {
        ...base,
        key: keys.squadCreated("q1"),
        type: "squad.created",
        data: {
          squadId: "q1",
          cwd: "/r",
          brief: "Todo app",
          models: { planner: "opus", roles: "opus" },
          budget: { mode: "plan", maxPercent: 20, window: "seven_day" },
          autonomy: "guarded",
        },
      },
      {
        ...base,
        key: keys.budget("q1", "squad", "q1", "warned"),
        type: "budget.warned",
        data: {
          squadId: "q1",
          scope: "squad",
          scopeId: "q1",
          unit: "points",
          used: 15,
          limit: 20,
          window: "seven_day",
          provider: "claude",
        },
      },
      {
        ...base,
        key: keys.budgetBaseline("q1", "claude", "seven_day", 1),
        type: "budget.baseline",
        data: {
          squadId: "q1",
          provider: "claude",
          window: "seven_day",
          round: 1,
          baseline: 34,
          carried: 0,
          current: 34,
        },
      },
      {
        ...base,
        key: keys.budgetMeasured("q1", "claude", "seven_day", 1, 41.5),
        type: "budget.measured",
        data: { squadId: "q1", provider: "claude", window: "seven_day", round: 1, last: 41.5 },
      },
      {
        ...base,
        key: keys.budgetChanged("q1", 1),
        type: "squad.budget_changed",
        data: { squadId: "q1", maxPercent: 30, previousPercent: 20 },
      },
    ];
    for (const e of events) expect(GravitaEvent.safeParse(e).success).toBe(true);
    const over = { ...events[0]!, data: { ...events[0]!.data, usedPercent: 140 } };
    expect(GravitaEvent.safeParse(over).success).toBe(false);
  });

  test("an API-key account's plan squad is refused with its own error", () => {
    expect(RpcErrors.planUsageUnavailable.code).toBe(4014);
  });
});

describe("squads with Codex roles", () => {
  test("a role may name its provider; anything else is refused", () => {
    const withCodex = { ...plan, roles: [{ ...plan.roles[0]!, provider: "codex" }] };
    expect(SquadPlan.safeParse(withCodex).success).toBe(true);
    const other = { ...plan, roles: [{ ...plan.roles[0]!, provider: "gemini" }] };
    expect(SquadPlan.safeParse(other).success).toBe(false);
  });

  test("squad.create takes who builds it; squad.created keeps it", () => {
    const create = RpcContract["squad.create"].params;
    const params = { cwd: "/w", brief: "b", budgetUsd: 5, autonomy: "auto" };
    expect(create.safeParse({ ...params, providers: "mixed" }).success).toBe(true);
    expect(create.safeParse({ ...params, providers: "both" }).success).toBe(false);
    expect(create.safeParse(params).success).toBe(true);
    const created = GravitaEvent.safeParse({
      ...base,
      key: keys.squadCreated("q"),
      type: "squad.created",
      data: {
        squadId: "q",
        cwd: "/w",
        brief: "b",
        models: { planner: "opus", roles: "sonnet" },
        budget: { mode: "plan", maxPercent: 20, window: "five_hour" },
        autonomy: "guarded",
        providers: "codex",
      },
    });
    expect(created.success).toBe(true);
  });

  test("Gravita's Codex profile: its status, its sign-in link, its error", () => {
    expect(
      RpcContract["codexProfile.signIn"].result.safeParse({ authUrl: "https://auth.openai.com/x" })
        .success,
    ).toBe(true);
    expect(RpcContract["codexProfile.signIn"].result.safeParse({ authUrl: "nope" }).success).toBe(
      false,
    );
    expect(
      RpcContract["codexProfile.status"].result.safeParse({ loggedIn: true, planType: "team" })
        .success,
    ).toBe(true);
    expect(RpcErrors.codexProfileSignedOut.code).toBe(4015);
  });
});
