/**
 * How to run the user's own Claude Code: the CLI found on this machine and the environment
 * of their login shell, reduced to an allowlist. Values are never logged.
 */
export interface ClaudeEnvironment {
  cliPath: string;
  cliVersion?: string;
  env: Record<string, string>;
}

export interface ClaudeEnvironmentSource {
  /** Rejects with `ClaudeUnavailableError` when the CLI is missing or outdated. */
  load(): Promise<ClaudeEnvironment>;
}
