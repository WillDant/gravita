import type { AgentProvider, PlanUsageLimit, UsageAccount } from "@gravita/protocol";

// Where plan usage comes from: each provider reads its account's plan windows its own way
// (Claude Code: a usage read on a running session; Codex: its app-server). A source never
// starts a session to read: without one running it has nothing to say.

export interface PlanUsageReading {
  /** False when plan limits don't apply to the account (an API key): budgets are dollars. */
  limited: boolean;
  planType?: string;
  /** The windows, in Gravita's provider-neutral terms. */
  limits: PlanUsageLimit[];
}

export interface PlanUsageSource {
  readonly provider: AgentProvider;
  /**
   * Whose plan it reads: absent for the user's own account, `squadProfile` for Gravita's
   * Codex profile that Codex squads run in. Only the user's own tells the provider's status.
   */
  readonly account?: UsageAccount;
  /**
   * Reads the account's plan usage through a session that is already running, `prefer`'s
   * first. Undefined when none is running, or the read failed or isn't supported.
   */
  read(prefer?: readonly string[]): Promise<PlanUsageReading | undefined>;
}
