import type { AgentProvider, CodexMode, PermissionMode, SessionMode } from "@gravita/protocol";

// Each provider names its session modes its own way: Claude Code has permission modes,
// Codex asks, writes in the workspace, or has full access. One small table maps them, so a
// setting carried from one provider to the other keeps its meaning.

/**
 * Claude's mode → Codex's. Plan mode has no Codex equivalent: Codex plans read-only
 * through its sandbox, so a plan session asks before anything.
 */
export const CODEX_MODE_OF: Readonly<Record<PermissionMode, CodexMode>> = {
  default: "ask",
  acceptEdits: "workspace",
  plan: "ask",
  bypassPermissions: "fullAccess",
};

/** Codex's mode → Claude's. */
export const CLAUDE_MODE_OF: Readonly<Record<CodexMode, PermissionMode>> = {
  ask: "default",
  workspace: "acceptEdits",
  fullAccess: "bypassPermissions",
};

/** The mode a session of each provider starts in when nobody picks one. */
export const DEFAULT_MODE: Readonly<Record<AgentProvider, SessionMode>> = {
  claude: "default",
  codex: "ask",
};

export function isClaudeMode(mode: string): mode is PermissionMode {
  return Object.hasOwn(CODEX_MODE_OF, mode);
}

export function isCodexMode(mode: string): mode is CodexMode {
  return Object.hasOwn(CLAUDE_MODE_OF, mode);
}

/** Whether `mode` is one of `provider`'s own modes. */
export function isModeOf(provider: AgentProvider, mode: string): boolean {
  return provider === "codex" ? isCodexMode(mode) : isClaudeMode(mode);
}

/** `mode` in Claude Code's terms. */
export function asClaudeMode(mode: SessionMode): PermissionMode {
  return isClaudeMode(mode) ? mode : CLAUDE_MODE_OF[mode];
}

/** `mode` in Codex's terms. */
export function asCodexMode(mode: SessionMode): CodexMode {
  return isCodexMode(mode) ? mode : CODEX_MODE_OF[mode];
}

/** `mode` in `provider`'s terms: unchanged when it is already one of its modes. */
export function modeFor(provider: AgentProvider, mode: SessionMode): SessionMode {
  return provider === "codex" ? asCodexMode(mode) : asClaudeMode(mode);
}
