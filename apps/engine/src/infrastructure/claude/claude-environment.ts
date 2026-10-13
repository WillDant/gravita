import type {
  ClaudeEnvironment,
  ClaudeEnvironmentSource,
} from "../../application/ports/claude-environment";
import { ClaudeUnavailableError } from "../../domain/errors";
import type { ClaudeStatus } from "./claude-cli-locator";

/**
 * The CLI found at start-up (awaited, so a session started right after launch doesn't race
 * the detection) plus the login shell's allowlisted environment.
 */
export class DetectedClaudeEnvironment implements ClaudeEnvironmentSource {
  constructor(
    private readonly detection: () => Promise<ClaudeStatus>,
    private readonly shellEnv: () => Promise<Record<string, string>>,
  ) {}

  async load(): Promise<ClaudeEnvironment> {
    const claude = await this.detection();
    if (!claude.found || !claude.path) throw new ClaudeUnavailableError("not-found");
    if (claude.outdated) throw new ClaudeUnavailableError("outdated");
    return {
      cliPath: claude.path,
      ...(claude.version ? { cliVersion: claude.version } : {}),
      env: await this.shellEnv(),
    };
  }
}
