import { codexSessionId, codexSessionPolicy, threadIdOf } from "@gravita/adapter-codex";
import type { CodexMode } from "@gravita/protocol";
import type { ProviderTerminalFlags } from "../../application/ports/terminal-host";

/** Claude Code's and Codex's interactive CLI flags for Gravita's choices. */
export const providerTerminalFlags: ProviderTerminalFlags = {
  modeArgs(provider, mode, cwd) {
    if (provider === "claude") {
      // Claude Code's default mode has no flag of its own: it is what runs without one.
      return mode === "default" ? [] : ["--permission-mode", mode];
    }
    const { approvalPolicy, sandbox } = codexSessionPolicy(mode as CodexMode, cwd);
    // Gravita's modes use Codex's named policies only (never the granular form).
    return typeof approvalPolicy === "string"
      ? ["-a", approvalPolicy, "-s", sandbox]
      : ["-s", sandbox];
  },
  resumeArg(provider, sessionId) {
    return provider === "codex" ? (threadIdOf(sessionId) ?? sessionId) : sessionId;
  },
  sessionIdOf(provider, resumeId) {
    return provider === "codex" ? codexSessionId(resumeId) : resumeId;
  },
};
