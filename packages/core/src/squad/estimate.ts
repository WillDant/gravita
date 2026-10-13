import type { SquadModels, SquadPlan, TaskSize } from "@gravita/protocol";

// A rough cost estimate shown before the user approves a plan. It is a ballpark, not a
// quote: real spend depends on the repo, the model's effort and how many retries a task
// needs. Every number lives here so it is easy to update when prices or habits change.

export type ModelFamily = "opus" | "sonnet" | "haiku";

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

/** First-party API list prices for the current generation of each family (Oct 2026). */
export const PRICES: Readonly<Record<ModelFamily, ModelPrice>> = {
  opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
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

/** The price family of a model string; "default" and anything unknown price as sonnet. */
export function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("haiku")) return "haiku";
  return "sonnet";
}

/** USD for a token use at a model's prices. */
export function tokenCost(model: string, t: TokenUse): number {
  const p = PRICES[modelFamily(model)];
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
}

/**
 * Rough cost of running a plan: the planner run at the planner model, then each task at
 * its role's model (the role's own `model`, else `models.roles`) and its size.
 */
export function estimatePlanCost(plan: SquadPlan, models: SquadModels): PlanEstimate {
  const plannerUsd = tokenCost(models.planner, PLANNER_TOKENS);
  const byRole: Record<string, number> = {};
  const byTask: Record<string, number> = {};
  for (const r of plan.roles) byRole[r.id] = 0;
  let totalUsd = plannerUsd;
  for (const t of plan.tasks) {
    const role = plan.roles.find((r) => r.id === t.role);
    const usd = tokenCost(role?.model ?? models.roles, TASK_TOKENS[t.size]);
    byTask[t.id] = (byTask[t.id] ?? 0) + usd;
    byRole[t.role] = (byRole[t.role] ?? 0) + usd;
    totalUsd += usd;
  }
  return { totalUsd, plannerUsd, byRole, byTask };
}
