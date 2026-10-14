import type { AgentProvider } from "@gravita/protocol";

/**
 * How to run the user's own coding agent: the provider's CLI found on this machine and
 * the environment of their login shell, reduced to an allowlist. Values are never logged.
 */
export interface AgentEnvironment {
  provider: AgentProvider;
  cliPath: string;
  cliVersion?: string;
  env: Record<string, string>;
}

/** Where one provider's environment comes from (one source per provider). */
export interface AgentEnvironmentSource {
  /**
   * Rejects with `ProviderUnavailableError` when the provider's CLI is missing or
   * outdated.
   */
  load(): Promise<AgentEnvironment>;
}
