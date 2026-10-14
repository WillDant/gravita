import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderStatus } from "@gravita/protocol";
import type { ProviderDetector } from "../../application/ports/provider-detector";
import { detectCli } from "../providers/cli-locator";
import { CURSOR } from "./provider";

/**
 * The `cursor-agent` release whose ACP messages and credential store Gravita was tested with
 * (it prints "2026.10.14-<hash>"); older ones are `outdated`.
 */
export const MIN_CURSOR_VERSION = "2026.10.14";

export function knownCursorPaths(home = homedir()): string[] {
  return [
    join(home, ".local/bin/cursor-agent"),
    "/opt/homebrew/bin/cursor-agent",
    "/usr/local/bin/cursor-agent",
  ];
}

/**
 * Finds the `cursor-agent` CLI through the login shell and known install paths, and reads
 * its version. Runs `cursor-agent --version` and nothing else: no credentials read.
 */
export function detectCursor(opts: { shell?: string; knownPaths?: string[] } = {}) {
  return detectCli({
    binary: "cursor-agent",
    knownPaths: opts.knownPaths ?? knownCursorPaths(),
    minVersion: MIN_CURSOR_VERSION,
    ...(opts.shell ? { shell: opts.shell } : {}),
  });
}

/** What Gravita knows of the key pasted in its settings, for a found CLI. */
export type CursorCredentialCheck = () => Promise<Partial<ProviderStatus>>;

/**
 * Cursor's detector: the CLI (path, version), then the state of the key the user pasted in
 * Gravita (never a login of their own: there is none to read). Tests replace `find`.
 */
export class CursorDetector implements ProviderDetector {
  readonly provider = CURSOR;

  constructor(
    private readonly find: () => Promise<ProviderStatus> = () => detectCursor(),
    private readonly credential?: CursorCredentialCheck,
  ) {}

  detect(): Promise<ProviderStatus> {
    return this.find();
  }

  async account(cli: ProviderStatus): Promise<Partial<ProviderStatus> | undefined> {
    if (!cli.found || cli.outdated || !this.credential) return undefined;
    return this.credential().catch(() => undefined);
  }
}
