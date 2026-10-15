import { codexSessionId, codexSessionPolicy, threadIdOf } from "@gravita/adapter-codex";
import { acpSessionIdOf, cursorSessionId } from "@gravita/adapter-cursor";
import { asCursorMode } from "@gravita/core";
import type { CodexMode, SessionMode } from "@gravita/protocol";
import type { ProviderTerminalFlags } from "../../application/ports/terminal-host";

/** Claude Code's, Codex's and Cursor's interactive CLI flags for Gravita's choices. */
export const providerTerminalFlags: ProviderTerminalFlags = {
  modeArgs(provider, mode, cwd) {
    if (provider === "claude") {
      // Claude Code's default mode has no flag of its own: it is what runs without one.
      return mode === "default" ? [] : ["--permission-mode", mode];
    }
    if (provider === "cursor") {
      // Cursor's default (agent) mode has no flag of its own, like Claude Code's.
      const cursorMode = asCursorMode(mode as SessionMode, "cursor");
      return cursorMode === "agent" ? [] : ["--mode", cursorMode];
    }
    const { approvalPolicy, sandbox } = codexSessionPolicy(mode as CodexMode, cwd);
    // Gravita's modes use Codex's named policies only (never the granular form).
    return typeof approvalPolicy === "string"
      ? ["-a", approvalPolicy, "-s", sandbox]
      : ["-s", sandbox];
  },
  resumeArg(provider, sessionId) {
    if (provider === "cursor") return acpSessionIdOf(sessionId) ?? sessionId;
    return provider === "codex" ? (threadIdOf(sessionId) ?? sessionId) : sessionId;
  },
  sessionIdOf(provider, resumeId) {
    if (provider === "cursor") return cursorSessionId(resumeId);
    return provider === "codex" ? codexSessionId(resumeId) : resumeId;
  },
};
