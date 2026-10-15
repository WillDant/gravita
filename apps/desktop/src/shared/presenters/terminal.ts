import type { TerminalInfo } from "@gravita/protocol";
import type { AgentProvider } from "@gravita/protocol/constants";
import { t } from "@/shared/i18n/i18n";

/**
 * The agent a terminal runs right now: the one it was started for, or, in a plain shell, the
 * one the engine sees running in front (the user typed `claude`). `undefined`: a plain shell
 * at its prompt.
 */
export function terminalProvider(
  terminal: Pick<TerminalInfo, "command" | "activeProvider">,
): AgentProvider | undefined {
  return terminal.command === "shell" ? terminal.activeProvider : terminal.command;
}

/** "Claude Code", "Codex", "Cursor Agent", or "Shell". */
export const terminalTitle = (provider: AgentProvider | undefined): string =>
  t(`terminal.title.${provider ?? "shell"}`);
