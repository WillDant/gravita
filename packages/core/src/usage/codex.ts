import type { PlanUsageLimit, UsageWindow } from "@gravita/protocol";

// Codex's plan usage in Gravita's terms. Codex reports two windows of the ChatGPT plan:
// `primary` (the 5-hour one) and `secondary` (the weekly one), each with the percent used,
// its length in minutes and when it resets, plus the plan type. The app-server sends them
// for `account/rateLimits/read` and in `account/rateLimits/updated` (camelCase), and rollouts
// carry the same under `token_count.rate_limits` (snake_case); both spellings map here.
// Pure, so the Codex runtime and the rollout reader share it.

type Loose = Record<string, unknown>;

const FIVE_HOURS_MIN = 300;
const WEEK_MIN = 7 * 24 * 60;

const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null;

function num(o: Loose, ...names: string[]): number | undefined {
  for (const n of names) {
    const v = o[n];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** A window's length in minutes → which plan window it is (a little slack either way). */
function windowOf(minutes: number | undefined, slot: "primary" | "secondary"): UsageWindow {
  if (minutes === undefined) return slot === "primary" ? "five_hour" : "seven_day";
  if (Math.abs(minutes - FIVE_HOURS_MIN) <= 30) return "five_hour";
  if (Math.abs(minutes - WEEK_MIN) <= 12 * 60) return "seven_day";
  return "other";
}

/** `resets_at` in epoch seconds (or an ISO string), else `resets_in_seconds` from `nowMs`. */
function resetsAtOf(o: Loose, nowMs: number): string | undefined {
  const at = o.resets_at ?? o.resetsAt;
  if (typeof at === "string" && !Number.isNaN(Date.parse(at))) return new Date(at).toISOString();
  if (typeof at === "number" && Number.isFinite(at)) {
    // Seconds since the epoch; a value in milliseconds is already past year 33000.
    return new Date(at > 1e12 ? at : at * 1000).toISOString();
  }
  const inSeconds = num(o, "resets_in_seconds", "resetsInSeconds");
  return inSeconds !== undefined ? new Date(nowMs + inSeconds * 1000).toISOString() : undefined;
}

/**
 * Codex's rate limits as plan usage windows. `payload` is the rate limits object itself, or
 * a response/notification that has it under `rateLimits` / `rate_limits`. Windows without a
 * percent are left out; `nowMs` turns a relative reset time into an absolute one.
 */
export function codexPlanUsage(payload: unknown, nowMs: number): PlanUsageLimit[] {
  if (!isObject(payload)) return [];
  const inner = payload.rateLimits ?? payload.rate_limits;
  const limits = isObject(inner) ? inner : payload;
  const plan = limits.plan_type ?? limits.planType ?? payload.plan_type ?? payload.planType;
  const planType = typeof plan === "string" && plan ? plan : undefined;
  const out: PlanUsageLimit[] = [];
  for (const slot of ["primary", "secondary"] as const) {
    const w = limits[slot];
    if (!isObject(w)) continue;
    const used = num(w, "used_percent", "usedPercent");
    if (used === undefined) continue;
    const window = windowOf(
      num(w, "window_minutes", "windowDurationMins", "window_duration_mins"),
      slot,
    );
    const resetsAt = resetsAtOf(w, nowMs);
    const usedPercent = Math.min(100, Math.max(0, used));
    out.push({
      window,
      usedPercent,
      ...(resetsAt ? { resetsAt } : {}),
      ...(planType ? { planType } : {}),
      ...(usedPercent >= 100 ? { status: "rejected" as const } : {}),
    });
  }
  return out;
}
