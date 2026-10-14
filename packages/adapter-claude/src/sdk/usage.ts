import type { PlanUsageLimit, UsageWindow } from "@gravita/protocol";

// Claude's plan usage in Gravita's provider-neutral terms, from the two places Claude Code
// tells it: the `rate_limit_event` stream message (when the info changes) and the answer of
// the usage read on a live session. Both describe claude.ai plan windows; an API-key
// account has none. Pure: the engine's usage source and the SDK mapper call these.

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null;

/**
 * A utilization as a percent. Usage reads document 0–100; rate limit events don't say, and
 * Claude Code's headers carry a fraction. A value above 1 can only be a percent; at or
 * below 1 it is read as a fraction unless this session already showed percents
 * (`knownPercent`). Misreading a tiny percent as a fraction errs towards pausing a squad
 * early, never towards overspending.
 */
export function toPercent(utilization: number, knownPercent = false): number {
  const percent = knownPercent || utilization > 1 ? utilization : utilization * 100;
  return Math.min(100, Math.max(0, Math.round(percent * 100) / 100));
}

/** A window of Claude's (a `rateLimitType` or a usage read's key) in Gravita's terms. */
export function claudeWindow(type: string): { window: UsageWindow; model?: string } {
  switch (type) {
    case "five_hour":
    case "seven_day":
      return { window: type };
    case "seven_day_opus":
      return { window: "seven_day_model", model: "opus" };
    case "seven_day_sonnet":
      return { window: "seven_day_model", model: "sonnet" };
    default:
      // Overage and anything newer: kept apart by its own name.
      return { window: "other", model: type };
  }
}

const STATUS: Record<string, PlanUsageLimit["status"]> = {
  allowed: "allowed",
  allowed_warning: "warning",
  rejected: "rejected",
};

/** Epoch seconds (or milliseconds) as ISO 8601. */
function isoFromEpoch(at: number): string {
  return new Date(at > 1e12 ? at : at * 1000).toISOString();
}

/**
 * The window a `rate_limit_event` reports, or undefined when it carries no number (a bare
 * status with no utilization says nothing a meter can count, unless it is a rejection: a
 * window that refuses requests is full).
 */
export function rateLimitUsage(
  info: { status?: string; resetsAt?: number; rateLimitType?: string; utilization?: number },
  knownPercent = false,
): PlanUsageLimit | undefined {
  const status = info.status ? STATUS[info.status] : undefined;
  const usedPercent =
    typeof info.utilization === "number" && Number.isFinite(info.utilization)
      ? toPercent(info.utilization, knownPercent)
      : status === "rejected"
        ? 100
        : undefined;
  if (usedPercent === undefined) return undefined;
  return {
    ...claudeWindow(info.rateLimitType ?? "five_hour"),
    usedPercent,
    ...(typeof info.resetsAt === "number" && Number.isFinite(info.resetsAt)
      ? { resetsAt: isoFromEpoch(info.resetsAt) }
      : {}),
    ...(status ? { status } : {}),
  };
}

export interface ClaudePlanUsage {
  /** False for an API key (and Bedrock, Vertex…): plan limits don't apply. */
  limited: boolean;
  /** "pro", "max", "team"… when Claude Code tells. */
  planType?: string;
  limits: PlanUsageLimit[];
}

/** One `{ utilization, resets_at }` window of a usage read. */
function readWindow(
  w: unknown,
  where: { window: UsageWindow; model?: string },
  planType: string | undefined,
): PlanUsageLimit | undefined {
  if (!isObject(w) || typeof w.utilization !== "number" || !Number.isFinite(w.utilization))
    return undefined;
  const resetsAt =
    typeof w.resets_at === "string" && !Number.isNaN(Date.parse(w.resets_at))
      ? new Date(w.resets_at).toISOString()
      : undefined;
  return {
    ...where,
    // Documented as a percent (0–100).
    usedPercent: toPercent(w.utilization, true),
    ...(resetsAt ? { resetsAt } : {}),
    ...(planType ? { planType } : {}),
  };
}

/**
 * The answer of Claude Code's usage read as plan usage. Undefined when it isn't one (an
 * unexpected shape: the API is experimental).
 */
export function claudePlanUsage(answer: unknown): ClaudePlanUsage | undefined {
  if (!isObject(answer) || typeof answer.rate_limits_available !== "boolean") return undefined;
  const planType =
    typeof answer.subscription_type === "string" && answer.subscription_type
      ? answer.subscription_type
      : undefined;
  const base = { limited: answer.rate_limits_available, ...(planType ? { planType } : {}) };
  const rl = answer.rate_limits;
  if (!answer.rate_limits_available || !isObject(rl)) return { ...base, limits: [] };
  const limits: PlanUsageLimit[] = [];
  const push = (l: PlanUsageLimit | undefined) => {
    if (l) limits.push(l);
  };
  for (const [name, w] of Object.entries(rl)) {
    if (name === "model_scoped" || name === "extra_usage") continue;
    push(readWindow(w, claudeWindow(name), planType));
  }
  // Per-model weekly windows the server lists by display name.
  if (Array.isArray(rl.model_scoped))
    for (const w of rl.model_scoped) {
      if (!isObject(w) || typeof w.display_name !== "string" || !w.display_name) continue;
      push(
        readWindow(w, { window: "seven_day_model", model: w.display_name.toLowerCase() }, planType),
      );
    }
  return { ...base, limits };
}
