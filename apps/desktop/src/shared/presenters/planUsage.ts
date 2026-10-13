import { budgetState, type SquadState, type UsageLimitState, usageKey } from "@gravita/core";
import type { AccountPlan, EngineStatus, PlanWindow } from "@gravita/protocol";
import type { AgentProvider } from "@gravita/protocol/constants";
import { t, when } from "@/shared/i18n/i18n";
import { usd } from "./money";

// Plan usage in the user's words: how much of each plan window their account has used and
// when it resets, and a squad's budget as points of its share. Usage is account-wide (their
// own sessions, claude.ai and ChatGPT count too), and the copy says so where it matters.

/** The plan windows shown for a provider, in order. */
export const SHOWN_WINDOWS: readonly PlanWindow[] = ["five_hour", "seven_day"];

/** Whether plan limits apply to the provider's account, once the engine knows. */
export function accountPlan(
  status: EngineStatus | undefined,
  provider: AgentProvider,
): AccountPlan | undefined {
  const p = status?.providers?.[provider] ?? (provider === "claude" ? status?.claude : undefined);
  return p?.account?.plan;
}

/** The provider's 5-hour and weekly readings that are known. */
export function planWindows(
  usage: Record<string, UsageLimitState> | undefined,
  provider: AgentProvider,
): UsageLimitState[] {
  return SHOWN_WINDOWS.flatMap((w) => {
    const u = usage?.[usageKey(provider, w)];
    return u ? [u] : [];
  });
}

/** A reading the provider marks as close to (or over) its limit: that waits on the user. */
export const nearLimit = (u: Pick<UsageLimitState, "status">): boolean =>
  u.status === "warning" || u.status === "rejected";

/** "34%", "6.5%": whole numbers when they are, one decimal otherwise. */
export function percent(n: number): string {
  return `${Math.round(n * 10) / 10}%`;
}

/** Points as a plain figure ("6", "6.5"). */
export function points(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** "Weekly: 34% used · resets Fri 9:00 AM". */
export function windowLine(u: UsageLimitState, now: number): string {
  const head = t("usage.used", {
    window: t(`usage.short.${u.window}`),
    percent: percent(u.usedPercent),
  });
  return u.resetsAt && Date.parse(u.resetsAt) > now
    ? `${head} · ${t("usage.resets", { when: when(u.resetsAt, now) })}`
    : head;
}

export interface BudgetFigure {
  /** What was used, in the budget's unit ("$4.20", "6"). */
  spent: string;
  /** The limit ("$25.00", "20 pts"). */
  total: string;
  /** spent / total, capped at 1. */
  share: number;
  /** A plan squad with nothing measured yet. */
  measuring: boolean;
  /** One sentence for screen readers and tooltips. */
  label: string;
}

/** A squad's budget and what it used, as the meter, the banner and the rows show it. */
export function budgetFigure(q: SquadState, usage: Record<string, UsageLimitState>): BudgetFigure {
  const b = budgetState(q, usage ?? {});
  const share = b.limit > 0 ? Math.min(1, b.ratio) : 0;
  if (b.unit === "usd")
    return {
      spent: usd(b.spent),
      total: usd(b.limit),
      share,
      measuring: false,
      label: t("squad.budget.label", { spent: usd(b.spent), total: usd(b.limit) }),
    };
  const window = t(`usage.window.${b.window ?? "seven_day"}`);
  return {
    spent: points(b.spent),
    total: t("squad.budget.pts", { count: b.limit }),
    share,
    measuring: b.measuring,
    label: b.measuring
      ? t("squad.budget.measuringLabel", { limit: points(b.limit), window })
      : t("squad.budget.pointsLabel", { used: points(b.spent), limit: points(b.limit), window }),
  };
}

/** "20% of your weekly limit". */
export function planShareText(q: SquadState): string | undefined {
  const plan = q.budgetPlan;
  return plan
    ? t("squad.budget.planShare", {
        limit: points(plan.maxPercent),
        window: t(`usage.window.${plan.window}`),
      })
    : undefined;
}

/** A plan squad's use in a row: "6 / 20 pts", or "measuring…" before its baseline. */
export function planUsed(q: SquadState, usage: Record<string, UsageLimitState>): string {
  const f = budgetFigure(q, usage);
  return f.measuring ? t("squad.budget.measuring") : `${f.spent} / ${f.total}`;
}
