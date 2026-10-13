import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderStatus } from "@gravita/protocol";
import type { ProviderDetector } from "../../application/ports/provider-detector";
import { detectCli } from "../providers/cli-locator";
import { CODEX } from "./provider";

/** The Codex release whose rollout format Gravita reads; older ones are `outdated`. */
export const MIN_CODEX_VERSION = "0.160.0";

export function knownCodexPaths(home = homedir()): string[] {
  return [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    join(home, ".local/bin/codex"),
    join(home, ".npm-global/bin/codex"),
  ];
}

/**
 * Finds the `codex` CLI through the login shell and known install paths, and reads its
 * version. Runs `codex --version` and nothing else: no login check, no credentials read.
 */
export function detectCodex(opts: { shell?: string; knownPaths?: string[] } = {}) {
  return detectCli({
    binary: "codex",
    knownPaths: opts.knownPaths ?? knownCodexPaths(),
    minVersion: MIN_CODEX_VERSION,
    ...(opts.shell ? { shell: opts.shell } : {}),
  });
}

/** Codex's detector; tests replace `find` so no real `codex` is looked for. */
export class CodexDetector implements ProviderDetector {
  readonly provider = CODEX;

  constructor(private readonly find: () => Promise<ProviderStatus> = () => detectCodex()) {}

  detect(): Promise<ProviderStatus> {
    return this.find();
  }
}
