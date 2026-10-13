import type { AgentProvider, ProviderStatus } from "@gravita/protocol";

/**
 * Finds one provider's CLI on this machine (its path, version and whether it is recent
 * enough). It runs the CLI's version command and nothing else: no login, no credentials.
 */
export interface ProviderDetector {
  readonly provider: AgentProvider;
  detect(): Promise<ProviderStatus>;
}
