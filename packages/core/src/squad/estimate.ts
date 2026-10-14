import type { SquadModels, SquadPlan, TaskSize } from "@gravita/protocol";
import {
  type ModelFamily,
  type ModelProvider,
  type ModelTier,
  modelTier,
  pickModel,
  tierModel,
} from "./models";
import { plannerProviderOf, roleProviderOf, type SquadProviderChoice } from "./providers";

// A rough cost estimate shown before the user approves a plan. It is a ballpark, not a
// quote: real spend depends on the repo, the model's effort and how many retries a task
// needs. Every number lives here so it is easy to update when prices or habits change.

export interface ModelPrice {
  /** USD per million uncached input tokens. */
  input: number;
  /** USD per million output tokens (thinking included). */
  output: number;
  /** USD per million tokens read from the prompt cache. */
  cacheRead: number;
  /** USD per million tokens written to the prompt cache (5-minute TTL, 1.25× input). */
  cacheWrite: number;
}

/**
 * First-party API list prices of each provider's tiers. Claude: the current generation of
 * Opus, Sonnet and Haiku (Oct 2026). Codex: what the same tokens would cost on OpenAI's API
 * for a GPT-5-class coding model, for display only (squads on Codex are budgeted in plan
 * usage, never in these dollars). Codex's tiers are one model at three efforts, so they
 * share the token prices and differ in how much reasoning (billed as output) a run
 * produces; the table folds that into the output price (low ≈ 0.6×, high ≈ 1.6× medium's).
 * OpenAI doesn't bill cache writes apart, so a cache write costs plain input.
 */
export const MODEL_PRICES: Readonly<
  Record<ModelProvider, Readonly<Record<ModelTier, ModelPrice>>>
> = {
  claude: {
    high: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    mid: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    low: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  },
  codex: {
    high: { input: 1.25, output: 16, cacheRead: 0.125, cacheWrite: 1.25 },
    mid: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.25 },
    low: { input: 1.25, output: 6, cacheRead: 0.125, cacheWrite: 1.25 },
  },
};

/** Claude's prices by family (the same table as `MODEL_PRICES.claude`). */
export const PRICES: Readonly<Record<ModelFamily, ModelPrice>> = {
  opus: MODEL_PRICES.claude.high,
  sonnet: MODEL_PRICES.claude.mid,
  haiku: MODEL_PRICES.claude.low,
};

export interface TokenUse {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Typical tokens for one agentic coding run, by task size. Agent loops resend their
 * context every turn, so most input is cache reads. Rough figures from Claude Code runs:
 * s ≈ a focused change in a few files, m ≈ a feature slice, l ≈ a subsystem.
 */
export const TASK_TOKENS: Readonly<Record<TaskSize, TokenUse>> = {
  s: { input: 20_000, output: 8_000, cacheRead: 400_000, cacheWrite: 60_000 },
  m: { input: 50_000, output: 25_000, cacheRead: 1_500_000, cacheWrite: 150_000 },
  l: { input: 100_000, output: 60_000, cacheRead: 4_000_000, cacheWrite: 300_000 },
};

/** The planner's run: reads the repo and the brief, writes the plan. */
export const PLANNER_TOKENS: Readonly<TokenUse> = {
  input: 30_000,
  output: 15_000,
  cacheRead: 600_000,
  cacheWrite: 80_000,
};

/** USD for a token use at the prices of a model's tier in its provider. */
export function tokenCost(model: string, t: TokenUse, provider: ModelProvider = "claude"): number {
  const p = MODEL_PRICES[provider][modelTier(model, provider)];
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheRead * p.cacheRead +
      t.cacheWrite * p.cacheWrite) /
    1_000_000
  );
}

export interface PlanEstimate {
  /** Planner run plus every task. */
  totalUsd: number;
  /** The planner's run alone (not in byRole). */
  plannerUsd: number;
  /** Task spend per role; every plan role appears, possibly at 0. */
  byRole: Record<string, number>;
  byTask: Record<string, number>;
  /** The model each task runs on: the squad's policy, or the override given for it. */
  taskModels: Record<string, string>;
  /**
   * Spend per tier, named by the provider's model for it (Claude: its families; Codex:
   * "default@<effort>"), the planner run included; tiers with no work are absent.
   */
  byModel: Partial<Record<string, number>>;
}

/**
 * Rough cost of running a plan: the planner run at the planning model, then each task at
 * the model the squad's policy picks for it (see `pickModel`) and its size. `taskModels`
 * overrides the model of some tasks, for a run that escalated or that the user retried
 * with another model. `providers` is the squad's choice (Claude Code only when absent):
 * each run is priced at its own provider's tiers.
 */
export function estimatePlanCost(
  plan: SquadPlan,
  models: SquadModels,
  taskModels: Readonly<Record<string, string>> = {},
  providers: SquadProviderChoice = "claude",
): PlanEstimate {
  const plannerProvider = plannerProviderOf(providers);
  const plannerModel = pickModel({ models, phase: "planning", provider: plannerProvider });
  const plannerUsd = tokenCost(plannerModel, PLANNER_TOKENS, plannerProvider);
  const byRole: Record<string, number> = {};
  const byTask: Record<string, number> = {};
  const picked: Record<string, string> = {};
  const byModel: Partial<Record<string, number>> = {};
  const add = (model: string, usd: number, provider: ModelProvider) => {
    const name = tierModel(provider, modelTier(model, provider));
    byModel[name] = (byModel[name] ?? 0) + usd;
  };
  add(plannerModel, plannerUsd, plannerProvider);
  for (const r of plan.roles) byRole[r.id] = 0;
  let totalUsd = plannerUsd;
  for (const t of plan.tasks) {
    const provider = roleProviderOf(
      providers,
      plan.roles.find((r) => r.id === t.role),
    );
    const model = taskModels[t.id] ?? pickModel({ models, phase: "task", plan, task: t, provider });
    const usd = tokenCost(model, TASK_TOKENS[t.size], provider);
    picked[t.id] = model;
    byTask[t.id] = (byTask[t.id] ?? 0) + usd;
    byRole[t.role] = (byRole[t.role] ?? 0) + usd;
    add(model, usd, provider);
    totalUsd += usd;
  }
  return { totalUsd, plannerUsd, byRole, byTask, taskModels: picked, byModel };
}
