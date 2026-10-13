import type { ProviderStatus } from "@gravita/protocol";
import { DetectedAgentEnvironment } from "../providers/detected-environment";
import { CLAUDE } from "./provider";

/** Claude Code's CLI as detected at start-up, with the login shell's allowlisted env. */
export class DetectedClaudeEnvironment extends DetectedAgentEnvironment {
  constructor(
    detection: () => Promise<ProviderStatus>,
    shellEnv: () => Promise<Record<string, string>>,
  ) {
    super(CLAUDE, detection, shellEnv);
  }
}
