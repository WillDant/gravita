import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderStatus } from "@gravita/protocol";
import type { ProviderDetector } from "../../application/ports/provider-detector";
import { compareVersions, detectCli, pathFromCommandV as pathOf } from "../providers/cli-locator";
import { CLAUDE } from "./provider";

export { compareVersions };

/** Picks the path out of `command -v` output (the `claude` binary unless told otherwise). */
export function pathFromCommandV(stdout: string, binary = "claude"): string | undefined {
  return pathOf(stdout, binary);
}

/** Nested subagent forwarding needs at least this CLI version. */
export const MIN_CLAUDE_VERSION = "2.1.219";

export function knownClaudePaths(home = homedir()): string[] {
  return [
    join(home, ".local/bin/claude"),
    join(home, ".claude/local/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
}

export interface DetectOptions {
  shell?: string;
  knownPaths?: string[];
}

/**
 * Finds the `claude` CLI through the login shell and known install paths, and reads
 * its version. Runs `claude --version` and nothing else.
 */
export function detectClaude(opts: DetectOptions = {}): Promise<ProviderStatus> {
  return detectCli({
    binary: "claude",
    knownPaths: opts.knownPaths ?? knownClaudePaths(),
    minVersion: MIN_CLAUDE_VERSION,
    ...(opts.shell ? { shell: opts.shell } : {}),
  });
}

/** Claude Code's detector; tests replace `detect` so no real `claude` is looked for. */
export class ClaudeDetector implements ProviderDetector {
  readonly provider = CLAUDE;

  constructor(private readonly find: () => Promise<ProviderStatus> = () => detectClaude()) {}

  detect(): Promise<ProviderStatus> {
    return this.find();
  }
}
