import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderStatus } from "@gravita/protocol";
import type { ProviderDetector } from "../../application/ports/provider-detector";
import { detectCli } from "../providers/cli-locator";
import { CODEX } from "./provider";

/**
 * The Codex release whose rollout format and app-server protocol Gravita was tested with;
 * older ones are `outdated`.
 */
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
 * version. Runs `codex --version` and nothing else: no credentials read.
 */
export function detectCodex(opts: { shell?: string; knownPaths?: string[] } = {}) {
  return detectCli({
    binary: "codex",
    knownPaths: opts.knownPaths ?? knownCodexPaths(),
    minVersion: MIN_CODEX_VERSION,
    ...(opts.shell ? { shell: opts.shell } : {}),
  });
}

/** What the account probe adds to a found Codex: its login and plan (see codex-account-probe). */
export type CodexLoginCheck = (cliPath: string) => Promise<Partial<ProviderStatus> | undefined>;

/**
 * Codex's detector: the CLI (path, version), and, for a current one, whether it is logged
 * in and on which plan, through a short-lived app-server handshake (no thread). Tests
 * replace `find` and `login` so no real `codex` is looked for.
 */
export class CodexDetector implements ProviderDetector {
  readonly provider = CODEX;

  constructor(
    private readonly find: () => Promise<ProviderStatus> = () => detectCodex(),
    private readonly login?: CodexLoginCheck,
  ) {}

  detect(): Promise<ProviderStatus> {
    return this.find();
  }

  async account(cli: ProviderStatus): Promise<Partial<ProviderStatus> | undefined> {
    if (!cli.found || cli.outdated || !cli.path || !this.login) return undefined;
    return this.login(cli.path).catch(() => undefined);
  }
}
