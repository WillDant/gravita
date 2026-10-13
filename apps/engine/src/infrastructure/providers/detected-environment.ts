import type { AgentProvider, ProviderStatus } from "@gravita/protocol";
import type {
  AgentEnvironment,
  AgentEnvironmentSource,
} from "../../application/ports/agent-environment";
import { ProviderUnavailableError } from "../../domain/errors";

/**
 * A provider's CLI as found at start-up (awaited, so a session started right after launch
 * doesn't race the detection) plus the login shell's allowlisted environment.
 */
export class DetectedAgentEnvironment implements AgentEnvironmentSource {
  constructor(
    readonly provider: AgentProvider,
    private readonly detection: () => Promise<ProviderStatus>,
    private readonly shellEnv: () => Promise<Record<string, string>>,
  ) {}

  async load(): Promise<AgentEnvironment> {
    const cli = await this.detection();
    if (!cli.found || !cli.path) throw new ProviderUnavailableError(this.provider, "not-found");
    if (cli.outdated) throw new ProviderUnavailableError(this.provider, "outdated");
    return {
      provider: this.provider,
      cliPath: cli.path,
      ...(cli.version ? { cliVersion: cli.version } : {}),
      env: await this.shellEnv(),
    };
  }
}
