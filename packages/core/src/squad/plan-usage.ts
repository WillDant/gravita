import type {
  AgentProvider,
  BudgetUnit,
  PlanWindow,
  SquadBudget,
  UsageWindow,
} from "@gravita/protocol";
import { type UsageLimitState, usageKey } from "../state";
import type { PlanMeter, SquadState } from "./state";

// A squad's budget as a share of the user's plan. Plan usage is account-wide (the user's
// own sessions, claude.ai and ChatGPT move it too), so a squad's share is what the window
// moved since the squad started building, measured per provider; with several providers
// the most consumed one counts. A window that resets mid-squad carries what the squad had
// used and counts again from 0. Everything here is pure: the engine's budget guard and the
// UI's meter read the same numbers.

/** A drop smaller than this is noise, not a new window. */
const RESET_EPSILON = 0.5;

/**
 * How much later a reading's reset time must be than the meter's to name a later window.
 * Providers compute it from "resets in N seconds" or round it, so the same window's reset
 * time moves a little between readings.
 */
const RESET_TOLERANCE_MS = 5 * 60_000;

/** The windows a plan budget can name. */
export const PLAN_BUDGET_WINDOWS: readonly PlanWindow[] = ["five_hour", "seven_day"];

export const isPlanWindow = (w: UsageWindow): w is PlanWindow =>
  (PLAN_BUDGET_WINDOWS as readonly string[]).includes(w);

/** The key of a meter in `SquadSpend.meters`. */
export const meterKey = (provider: string, window: string): string => `${provider}:${window}`;

/** Phases in which a plan squad's meters follow the window. */
const COUNTING_PHASES: ReadonlySet<string> = new Set(["foundation", "build", "verify"]);

/**
 * Whether new readings count for the squad: only while it works. A paused or finished
 * squad isn't what moves the window (resuming starts the count again from the window's
 * usage then, when Gravita has a fresh reading).
 */
export const isCounting = (q: SquadState): boolean => !q.paused && COUNTING_PHASES.has(q.phase);

/** The squad's budget as the protocol states it: a plan share, or dollars. */
export function squadBudget(q: SquadState): SquadBudget {
  return q.budgetPlan
    ? { mode: "plan", maxPercent: q.budgetPlan.maxPercent, window: q.budgetPlan.window }
    : { mode: "usd", amount: q.budgetUsd };
}

export const isPlanSquad = (q: SquadState): boolean => q.budgetPlan !== undefined;

/** One reading of a window, as the meter needs it. */
export interface UsageSample {
  usedPercent: number;
  resetsAt?: string;
  /** When it was read. */
  ts: string;
}

/** Where a reading belongs, compared with the window a meter counts. */
export type SampleWindow = "same" | "new" | "stale";

/**
 * Whether `sample` belongs to the window the meter counts, a later one, or an earlier one
 * (stale: a reading of a window that had already reset when it was taken, or that resets
 * well before the meter's). A later window needs evidence: a reset time clearly after the
 * meter's, or, when either has no reset time, a drop below the highest reading after the
 * meter's reset time (or below the baseline at any time). Read after the reset time
 * alone, a reading may still be a late one of the old window.
 */
export function sampleWindow(m: PlanMeter, sample: UsageSample): SampleWindow {
  const ts = Date.parse(sample.ts);
  const own = sample.resetsAt !== undefined ? Date.parse(sample.resetsAt) : undefined;
  if (own !== undefined && own <= ts) return "stale";
  const resetsAt = m.resetsAt !== undefined ? Date.parse(m.resetsAt) : undefined;
  if (own !== undefined && resetsAt !== undefined) {
    if (own > resetsAt + RESET_TOLERANCE_MS) return "new";
    return own < resetsAt - RESET_TOLERANCE_MS ? "stale" : "same";
  }
  if (sample.usedPercent < m.baseline - RESET_EPSILON) return "new";
  const afterReset = resetsAt !== undefined && ts >= resetsAt;
  return afterReset && sample.usedPercent < m.last - RESET_EPSILON ? "new" : "same";
}

/** Whether `sample` belongs to a later window than the one the meter counts. */
export const isNewWindow = (m: PlanMeter, sample: UsageSample): boolean =>
  sampleWindow(m, sample) === "new";

/** A meter starting at `sample` (round 1, nothing carried). */
export function startMeter(
  provider: AgentProvider,
  window: PlanWindow,
  sample: Omit<UsageSample, "ts">,
): PlanMeter {
  return {
    provider,
    window,
    baseline: sample.usedPercent,
    carried: 0,
    last: sample.usedPercent,
    ...(sample.resetsAt ? { resetsAt: sample.resetsAt } : {}),
    round: 1,
    savedRound: 0,
  };
}

/**
 * The meter after one more reading. Within a window the count only grows (`last` keeps the
 * highest reading); in a new window what the squad used so far is carried and the count
 * starts again from 0, so the share never goes down. A stale reading changes nothing, so
 * the meter never takes a reset time already past when it was read.
 */
export function advanceMeter(m: PlanMeter, sample: UsageSample): PlanMeter {
  const where = sampleWindow(m, sample);
  if (where === "stale") return m;
  if (where === "new") {
    const { resetsAt: _old, ...rest } = m;
    return {
      ...rest,
      carried: m.carried + Math.max(0, m.last - m.baseline),
      baseline: 0,
      last: sample.usedPercent,
      ...(sample.resetsAt ? { resetsAt: sample.resetsAt } : {}),
      round: m.round + 1,
    };
  }
  const resetsAt = sample.resetsAt ?? m.resetsAt;
  return {
    ...m,
    last: Math.max(m.last, sample.usedPercent),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

/** Points of the window the squad used, by its meter and (when newer) the latest reading. */
export function meterPoints(m: PlanMeter, sample?: UsageSample): number {
  const next = sample ? advanceMeter(m, sample) : m;
  return round2(next.carried + Math.max(0, next.last - next.baseline));
}

export interface PlanShare {
  /** The share used: the most consumed provider's points; undefined while measuring. */
  points?: number;
  /** Points per provider that has a meter. */
  byProvider: Partial<Record<AgentProvider, number>>;
  /** The provider whose window counted most. */
  provider?: AgentProvider;
}

/**
 * How many points of its window a plan squad used: per provider, from its meter and the
 * latest reading in `usage`, and overall the most consumed provider. Nothing measured yet
 * (no meter) gives no points: the squad is still measuring.
 */
export function planShareUsed(q: SquadState, usage: Record<string, UsageLimitState>): PlanShare {
  const plan = q.budgetPlan;
  if (!plan) return { byProvider: {} };
  const byProvider: Partial<Record<AgentProvider, number>> = {};
  const counting = isCounting(q);
  let points: number | undefined;
  let provider: AgentProvider | undefined;
  for (const m of Object.values(q.budget.meters ?? {})) {
    if (m.window !== plan.window) continue;
    const used = meterPoints(m, counting ? usage[usageKey(m.provider, m.window)] : undefined);
    byProvider[m.provider] = used;
    if (points === undefined || used > points) {
      points = used;
      provider = m.provider;
    }
  }
  return {
    ...(points !== undefined ? { points } : {}),
    byProvider,
    ...(provider ? { provider } : {}),
  };
}

export interface BudgetState {
  /** Dollars spent, or points of the window used (0 while measuring). */
  spent: number;
  /** The budget in its unit. */
  limit: number;
  unit: BudgetUnit;
  /** spent / limit (0 when there is no limit). */
  ratio: number;
  /** A plan squad with nothing measured yet: it can't be warned or paused. */
  measuring: boolean;
  window?: PlanWindow;
  /** Plan squads: the provider whose window counted most. */
  provider?: AgentProvider;
}

/** The squad's budget and what it used, in one unit: what the guard and the meter read. */
export function budgetState(q: SquadState, usage: Record<string, UsageLimitState>): BudgetState {
  if (!q.budgetPlan) {
    const limit = q.budgetUsd;
    const spent = q.budget.spentUsd;
    return { spent, limit, unit: "usd", ratio: limit > 0 ? spent / limit : 0, measuring: false };
  }
  const share = planShareUsed(q, usage);
  const limit = q.budgetPlan.maxPercent;
  const spent = share.points ?? 0;
  return {
    spent,
    limit,
    unit: "points",
    ratio: limit > 0 ? spent / limit : 0,
    measuring: share.points === undefined,
    window: q.budgetPlan.window,
    ...(share.provider ? { provider: share.provider } : {}),
  };
}

/** The readings of one provider's plan windows. */
export function providerUsage(
  usage: Record<string, UsageLimitState>,
  provider: AgentProvider,
): UsageLimitState[] {
  return Object.values(usage).filter((u) => u.provider === provider);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
