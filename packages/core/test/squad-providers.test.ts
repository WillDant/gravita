import { describe, expect, test } from "bun:test";
import { type GravitaEvent, keys, SquadPlan } from "@gravita/protocol";
import {
  AUTO_MODELS,
  AUTO_MODELS_BY_PROVIDER,
  allowedProviders,
  apply,
  CODEX_EFFORTS,
  codexModel,
  emptyState,
  estimatePlanCost,
  inProvider,
  isCodexModel,
  MODEL_CHOICES,
  MODEL_PRICES,
  modelTier,
  PROVIDER_MODELS,
  parseCodexModel,
  pickModel,
  plannerProviderOf,
  roleProviderOf,
  squadProvidersOf,
  squadTaskModel,
  stepUp,
  tokenCost,
  validatePlan,
} from "../src";
import { samplePlan } from "./squad-fixture";

// Squads with Codex roles: which provider each run is on, the Automatic policy in Codex's
// tiers (one model, three efforts), estimates priced per provider, and the plan's providers
// checked against the squad's choice.

/** The sample plan with the backend on Codex and the frontend on Claude Code. */
function mixed(): SquadPlan {
  const p = samplePlan();
  return {
    ...p,
    roles: p.roles.map((r) =>
      r.id === "backend"
        ? { ...r, provider: "codex" as const }
        : r.id === "frontend"
          ? { ...r, provider: "claude" as const }
          : r,
    ),
  };
}

describe("who builds a squad", () => {
  test("Claude Code only, Codex only, or each role's own (Claude Code when it names none)", () => {
    const codexRole = { provider: "codex" as const };
    expect(roleProviderOf(undefined, codexRole)).toBe("claude");
    expect(roleProviderOf("claude", codexRole)).toBe("claude");
    expect(roleProviderOf("codex", {})).toBe("codex");
    expect(roleProviderOf("mixed", codexRole)).toBe("codex");
    expect(roleProviderOf("mixed", {})).toBe("claude");
    expect(allowedProviders("mixed")).toEqual(["claude", "codex"]);
    expect(allowedProviders(undefined)).toEqual(["claude"]);
  });

  test("the briefing and the planner run on Codex only in a Codex-only squad", () => {
    expect(plannerProviderOf("codex")).toBe("codex");
    expect(plannerProviderOf("mixed")).toBe("claude");
    expect(plannerProviderOf(undefined)).toBe("claude");
  });

  test("a squad's providers: its planner's and its building roles'", () => {
    expect(squadProvidersOf("mixed", mixed())).toEqual(["claude", "codex"]);
    expect(squadProvidersOf("mixed", samplePlan())).toEqual(["claude"]);
    expect(squadProvidersOf("codex", samplePlan())).toEqual(["codex"]);
    expect(squadProvidersOf(undefined)).toEqual(["claude"]);
  });

  test("a role may run only on a provider the squad's choice allows", () => {
    const plan = mixed();
    expect(validatePlan(plan, { providers: "mixed" })).toEqual([]);
    expect(validatePlan(plan, { providers: "claude" })).toEqual([
      {
        code: "provider_not_allowed",
        message: 'Role "backend" runs on Codex, but this squad is Claude Code only.',
        path: "roles[1].provider",
      },
    ]);
    expect(validatePlan(plan, { providers: "codex" }).map((i) => i.path)).toEqual([
      "roles[2].provider",
    ]);
    // Without a choice: Claude Code only, as before Codex roles.
    expect(validatePlan(plan).map((i) => i.code)).toEqual(["provider_not_allowed"]);
    expect(validatePlan(samplePlan())).toEqual([]);
  });

  test("Cursor never builds a squad: no choice allows it, and a plan can't name it", () => {
    for (const choice of ["claude", "codex", "mixed"] as const)
      expect(allowedProviders(choice)).not.toContain("cursor");
    const plan = mixed();
    const roles = plan.roles.map((r, i) => (i === 1 ? { ...r, provider: "cursor" } : r));
    expect(SquadPlan.safeParse({ ...plan, roles }).success).toBe(false);
  });

  test("squad.created keeps the choice; older squads have none", () => {
    const created = (providers?: "mixed"): GravitaEvent => ({
      key: keys.squadCreated("q1"),
      ts: "2026-10-13T10:00:00.000Z",
      source: "gravita",
      provider: "gravita",
      projectId: "p",
      type: "squad.created",
      data: {
        squadId: "q1",
        cwd: "/w",
        brief: "b",
        models: AUTO_MODELS,
        budget: { mode: "plan", maxPercent: 20, window: "five_hour" },
        autonomy: "guarded",
        ...(providers ? { providers } : {}),
      },
    });
    const s = emptyState();
    apply(s, created("mixed"));
    expect(s.squads?.q1?.providers).toBe("mixed");
    const old = emptyState();
    apply(old, created());
    expect(old.squads?.q1?.providers).toBeUndefined();
  });
});

describe("Codex's model tiers: the default model at three efforts", () => {
  test("tiers, their efforts and the spelling", () => {
    expect(PROVIDER_MODELS.codex).toEqual({
      low: "default@low",
      mid: "default@medium",
      high: "default@high",
    });
    expect(CODEX_EFFORTS).toEqual({ low: "low", mid: "medium", high: "high" });
    expect(parseCodexModel("default@high")).toEqual({ effort: "high" });
    expect(parseCodexModel("gpt-6-astra@low")).toEqual({ model: "gpt-6-astra", effort: "low" });
    expect(parseCodexModel("gpt-6-astra")).toEqual({ model: "gpt-6-astra" });
    expect(codexModel(undefined, "medium")).toBe("default@medium");
    expect(isCodexModel("gpt-6.1-sol")).toBe(true);
    expect(isCodexModel("default@low")).toBe(true);
    expect(isCodexModel("opus")).toBe(false);
  });

  test.each([
    ["default@low", "low"],
    ["default@minimal", "low"],
    ["gpt-6-sol@medium", "mid"],
    ["gpt-6-sol", "mid"],
    ["default@xhigh", "high"],
    ["default@ultra", "high"],
  ] as const)("%s is Codex's %s tier", (model, tier) => {
    expect(modelTier(model, "codex")).toBe(tier);
  });

  test("stepping up climbs the effort, keeps a named model, and stops at high", () => {
    expect(stepUp("default@low", 1, "codex")).toBe("default@medium");
    expect(stepUp("default@medium", 5, "codex")).toBe("default@high");
    expect(stepUp("gpt-6-astra@medium", 1, "codex")).toBe("gpt-6-astra@high");
    expect(stepUp("default@high", 1, "codex")).toBe("default@high");
  });

  test("a policy written in Claude's names runs the same tier on Codex, and back", () => {
    expect(inProvider("sonnet", "codex")).toBe("default@medium");
    expect(inProvider("opus", "codex")).toBe("default@high");
    expect(inProvider("haiku", "codex")).toBe("default@low");
    expect(inProvider("gpt-6-astra", "codex")).toBe("gpt-6-astra");
    expect(inProvider("default@high", "claude")).toBe("opus");
    expect(inProvider("sonnet", "claude")).toBe("sonnet");
    expect(AUTO_MODELS_BY_PROVIDER.codex).toEqual({
      mode: "auto",
      briefing: "default@medium",
      planner: "default@high",
      roles: "default@medium",
    });
  });

  test("the Automatic policy on Codex: medium for everyday work, high where it matters", () => {
    const plan = samplePlan();
    const task = (id: string) => plan.tasks.find((t) => t.id === id)!;
    const pick = (o: Partial<Parameters<typeof pickModel>[0]>) =>
      pickModel({ models: AUTO_MODELS, provider: "codex", phase: "task", plan, ...o });
    expect(pick({ phase: "briefing" })).toBe("default@medium");
    expect(pick({ phase: "planning" })).toBe("default@high");
    expect(pick({ task: task("api-todos") })).toBe("default@medium");
    // Foundation, and large: one tier up.
    expect(pick({ task: task("api-contract") })).toBe("default@high");
    expect(pick({ task: task("web-list") })).toBe("default@high");
    // A struggling task steps up its effort.
    expect(pick({ task: task("api-todos"), escalations: 1 })).toBe("default@high");
    // Fixed choices keep their tier; a role's own model wins.
    expect(
      pickModel({
        models: MODEL_CHOICES.opus,
        provider: "codex",
        phase: "task",
        plan,
        task: task("api-todos"),
      }),
    ).toBe("default@high");
    const own = { ...plan, roles: plan.roles.map((r) => ({ ...r, model: "gpt-6-astra" })) };
    expect(pick({ plan: own, task: task("api-todos"), escalations: 2 })).toBe("gpt-6-astra");
  });

  test("a task's model follows its role's provider", () => {
    const plan = mixed();
    const q = { models: AUTO_MODELS, tasks: {}, providers: "mixed" as const };
    expect(squadTaskModel(q, plan, "api-todos")).toBe("default@medium");
    expect(squadTaskModel(q, plan, "web-list")).toBe("opus");
    expect(squadTaskModel({ ...q, providers: undefined }, plan, "api-todos")).toBe("sonnet");
  });
});

describe("estimates across providers", () => {
  test("Codex runs are priced at API-equivalent rates for its tiers, for display only", () => {
    const use = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
    expect(tokenCost("default@medium", use, "codex")).toBe(
      MODEL_PRICES.codex.mid.input + MODEL_PRICES.codex.mid.output,
    );
    // More effort, more reasoning tokens: a higher tier costs more.
    expect(tokenCost("default@high", use, "codex")).toBeGreaterThan(
      tokenCost("default@medium", use, "codex"),
    );
    expect(tokenCost("default@medium", use, "codex")).toBeGreaterThan(
      tokenCost("default@low", use, "codex"),
    );
  });

  test("a mixed plan prices each task at its role's provider; the planner on Claude Code", () => {
    const plan = mixed();
    const e = estimatePlanCost(plan, AUTO_MODELS, {}, "mixed");
    expect(e.taskModels).toEqual({
      "api-contract": "default@high",
      "api-todos": "default@medium",
      "web-list": "opus",
    });
    expect(Object.keys(e.byModel).sort()).toEqual(["default@high", "default@medium", "opus"]);
    // The planner (Claude Code, Opus) is in "opus" with web-list.
    const claudeOnly = estimatePlanCost(plan, AUTO_MODELS);
    expect(claudeOnly.taskModels["api-todos"]).toBe("sonnet");
    expect(e.totalUsd).not.toBe(claudeOnly.totalUsd);
  });

  test("a Codex-only plan prices its planner on Codex too", () => {
    const e = estimatePlanCost(samplePlan(), AUTO_MODELS, {}, "codex");
    expect(Object.keys(e.byModel).every((m) => m.startsWith("default@"))).toBe(true);
    expect(e.plannerUsd).toBeGreaterThan(0);
  });
});
