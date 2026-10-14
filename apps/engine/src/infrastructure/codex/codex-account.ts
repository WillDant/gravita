import type { CodexProtocol } from "@gravita/adapter-codex";
import { codexPlanUsage } from "@gravita/core";
import type { GravitaEvent, ProviderStatus } from "@gravita/protocol";
import type { PlanUsageReading } from "../../application/ports/plan-usage-source";

// What Codex's account reads say, in Gravita's terms. Only the kind of login and the plan
// are kept: never the email or the account id Codex also returns.

/** `account/read` → whether Codex is logged in, and how. */
export function accountStatusOf(res: CodexProtocol.GetAccountResponse): Partial<ProviderStatus> {
  const a = res.account;
  // A provider that needs no OpenAI login (a local or custom one) is ready as it is.
  if (!a) return { loggedIn: !res.requiresOpenaiAuth };
  switch (a.type) {
    case "apiKey":
      return { loggedIn: true, account: { authMode: "apikey", plan: "api" } };
    case "chatgpt":
      return { loggedIn: true, account: { authMode: "chatgpt", planType: a.planType } };
    default:
      return { loggedIn: true, account: { authMode: a.type } };
  }
}

/** `account/rateLimits/read` → plan usage; undefined when it reports no plan windows. */
export function readingOf(
  res: CodexProtocol.GetAccountRateLimitsResponse,
  nowMs: number,
): PlanUsageReading | undefined {
  const limits = codexPlanUsage(res.rateLimits, nowMs);
  if (!limits.length) return undefined;
  const planType = res.rateLimits.planType ?? undefined;
  return { limited: true, ...(planType ? { planType } : {}), limits };
}

// Codex squads run in Gravita's own Codex profile, which may be signed in to another
// ChatGPT account than the user's own Codex: its plan windows are its own, told apart from
// the user's by `account: "squadProfile"` (core's squadAccountOf).

/** A reading of Gravita's Codex profile: each window names the account it is of. */
export function squadProfileReading(r: PlanUsageReading): PlanUsageReading {
  return { ...r, limits: r.limits.map((l) => ({ ...l, account: "squadProfile" as const })) };
}

/** A squad session's events: its rate limits are the profile's, not the user's. */
export function asSquadProfileUsage(events: GravitaEvent[]): GravitaEvent[] {
  return events.map((e) =>
    e.type === "usage.limits" ? { ...e, data: { ...e.data, account: "squadProfile" } } : e,
  );
}
