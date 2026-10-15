import type { SessionState } from "@gravita/core";
import type { TerminalInfo } from "@gravita/protocol";
import { AGENT_PROVIDERS, type AgentProvider } from "@gravita/protocol/constants";
import { t } from "@/shared/i18n/i18n";

/**
 * The agent a terminal runs: the one it was started for, or, in a plain shell, the one whose
 * session started in it. `undefined`: a plain shell.
 */
export function terminalProvider(
  terminal: Pick<TerminalInfo, "command" | "sessionId">,
  sessions: Readonly<Record<string, Pick<SessionState, "provider"> | undefined>>,
): AgentProvider | undefined {
  if (terminal.command !== "shell") return terminal.command;
  const provider = terminal.sessionId ? sessions[terminal.sessionId]?.provider : undefined;
  return AGENT_PROVIDERS.find((p) => p === provider);
}

/** "Claude Code", "Codex", "Cursor", or "Shell". */
export const terminalTitle = (provider: AgentProvider | undefined): string =>
  t(`terminal.title.${provider ?? "shell"}`);
