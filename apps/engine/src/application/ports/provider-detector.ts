import type { AgentProvider, ProviderStatus } from "@gravita/protocol";

/**
 * Finds one provider's CLI on this machine (its path, version and whether it is recent
 * enough). It runs the CLI's version command and nothing else: no login, no credentials.
 */
export interface ProviderDetector {
  readonly provider: AgentProvider;
  detect(): Promise<ProviderStatus>;
  /**
   * What the found CLI says about its account (logged in, on which plan), when the
   * provider can tell without a session. Asked after `detect`, so a slow answer never holds
   * up the CLI's status. It never logs in.
   */
  account?(cli: ProviderStatus): Promise<Partial<ProviderStatus> | undefined>;
}
