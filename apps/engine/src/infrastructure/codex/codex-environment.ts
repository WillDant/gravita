import type { ProviderStatus } from "@gravita/protocol";
import { DetectedAgentEnvironment } from "../providers/detected-environment";
import { filterCodexEnv } from "../system/login-shell-env";
import { CODEX } from "./provider";

/** Codex's CLI as detected at start-up, with the login shell's allowlisted env. */
export class DetectedCodexEnvironment extends DetectedAgentEnvironment {
  constructor(
    detection: () => Promise<ProviderStatus>,
    shellEnv: () => Promise<Record<string, string>>,
  ) {
    super(CODEX, detection, shellEnv);
  }
}

/**
 * The environment a Codex chat's app-server gets: the allowlisted login-shell env, the
 * user's own CODEX_HOME (their shell's, else the one Gravita reads sessions from, so the
 * chat's rollout lands where Gravita looks), and Gravita's marker.
 */
export function codexChatEnv(
  env: Record<string, string>,
  codexHome: string | undefined,
  extra: Record<string, string> = {},
): Record<string, string> {
  const filtered = filterCodexEnv(env);
  const home = filtered.CODEX_HOME ?? codexHome;
  return {
    ...filtered,
    ...(home ? { CODEX_HOME: home } : {}),
    GRAVITA_MANAGED: "1",
    ...extra,
  };
}
