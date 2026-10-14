import type { ProviderStatus } from "@gravita/protocol";
import { DetectedAgentEnvironment } from "../providers/detected-environment";
import { filterCursorEnv } from "../system/login-shell-env";
import { CURSOR } from "./provider";

/** Cursor's CLI as detected at start-up, with the login shell's allowlisted env. */
export class DetectedCursorEnvironment extends DetectedAgentEnvironment {
  constructor(
    detection: () => Promise<ProviderStatus>,
    shellEnv: () => Promise<Record<string, string>>,
  ) {
    super(CURSOR, detection, shellEnv);
  }
}

/**
 * The whole environment of a `cursor-agent` process Gravita starts, built from scratch
 * (ADR 008): the shell's base allowlist (no `CURSOR_*`, no `AGENT_CLI_*`), the key pasted in
 * Gravita as `CURSOR_API_KEY`, an in-memory credential store (so the user's own login, in
 * the Keychain or `~/.cursor`, is neither read nor written) and no browser login.
 */
export function cursorChatEnv(
  shellEnv: Record<string, string>,
  key: string,
): Record<string, string> {
  return {
    ...filterCursorEnv(shellEnv),
    CURSOR_API_KEY: key,
    AGENT_CLI_CREDENTIAL_STORE: "memory",
    NO_OPEN_BROWSER: "1",
    GRAVITA_MANAGED: "1",
  };
}
