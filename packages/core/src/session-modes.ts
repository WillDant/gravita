import type {
  AgentProvider,
  CodexMode,
  CursorMode,
  PermissionMode,
  Provider,
  SessionMode,
} from "@gravita/protocol";

// Each provider names its session modes its own way: Claude Code has permission modes,
// Codex asks, writes in the workspace, or has full access; Cursor acts, plans or answers.
// Small tables map them through Claude Code's terms, so a setting carried from one provider
// to another keeps its meaning. Two names are shared ("plan" by Claude Code and Cursor, "ask"
// by Codex and Cursor), so a mode is read in its provider's terms when the provider is known.

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

/**
 * Claude's mode → Cursor's. Cursor has no full access: every mode that writes is Agent,
 * which asks Gravita before what Cursor wants approved.
 */
export const CURSOR_MODE_OF: Readonly<Record<PermissionMode, CursorMode>> = {
  default: "agent",
  acceptEdits: "agent",
  plan: "plan",
  bypassPermissions: "agent",
};

/** Cursor's mode → Claude's. Ask (read-only answers) is closest to Plan. */
export const CLAUDE_MODE_OF_CURSOR: Readonly<Record<CursorMode, PermissionMode>> = {
  agent: "default",
  plan: "plan",
  ask: "plan",
};

/** The mode a session of each provider starts in when nobody picks one. */
export const DEFAULT_MODE: Readonly<Record<AgentProvider, SessionMode>> = {
  claude: "default",
  codex: "ask",
  cursor: "agent",
};

export function isClaudeMode(mode: string): mode is PermissionMode {
  return Object.hasOwn(CODEX_MODE_OF, mode);
}

export function isCodexMode(mode: string): mode is CodexMode {
  return Object.hasOwn(CLAUDE_MODE_OF, mode);
}

export function isCursorMode(mode: string): mode is CursorMode {
  return Object.hasOwn(CLAUDE_MODE_OF_CURSOR, mode);
}

/** Whether `mode` is one of `provider`'s own modes. */
export function isModeOf(provider: AgentProvider, mode: string): boolean {
  switch (provider) {
    case "claude":
      return isClaudeMode(mode);
    case "codex":
      return isCodexMode(mode);
    case "cursor":
      return isCursorMode(mode);
    default:
      return unknownProvider(provider);
  }
}

/**
 * `mode` in Claude Code's terms. `from` names the provider whose terms `mode` is in; without
 * it a shared name reads as Claude Code's, then Codex's ("ask").
 */
export function asClaudeMode(mode: SessionMode, from?: Provider): PermissionMode {
  if (from === "cursor" && isCursorMode(mode)) return CLAUDE_MODE_OF_CURSOR[mode];
  if (isClaudeMode(mode)) return mode;
  if (isCodexMode(mode)) return CLAUDE_MODE_OF[mode];
  return CLAUDE_MODE_OF_CURSOR[mode];
}

/** `mode` in Codex's terms (`from` as for `asClaudeMode`). */
export function asCodexMode(mode: SessionMode, from?: Provider): CodexMode {
  if (from !== "cursor" && isCodexMode(mode)) return mode;
  return CODEX_MODE_OF[asClaudeMode(mode, from)];
}

/** `mode` in Cursor's terms (`from` as for `asClaudeMode`). */
export function asCursorMode(mode: SessionMode, from?: Provider): CursorMode {
  if (from === "cursor" ? isCursorMode(mode) : mode === "agent") return mode as CursorMode;
  return CURSOR_MODE_OF[asClaudeMode(mode, from)];
}

/**
 * `mode` in `provider`'s terms: unchanged when it is already one of its modes (`from` as
 * for `asClaudeMode`).
 */
export function modeFor(provider: AgentProvider, mode: SessionMode, from?: Provider): SessionMode {
  switch (provider) {
    case "claude":
      return asClaudeMode(mode, from);
    case "codex":
      return asCodexMode(mode, from);
    case "cursor":
      return asCursorMode(mode, from);
    default:
      return unknownProvider(provider);
  }
}

/**
 * A session's mode as `session.settings` records it: in Claude Code's terms, plus the
 * provider's own mode when those terms lose it (Cursor's `ask` reads as `plan`).
 */
export function settingsModeOf(
  provider: Provider,
  mode: SessionMode,
): { permissionMode: PermissionMode; providerMode?: SessionMode } {
  const permissionMode = asClaudeMode(mode, provider);
  if (provider !== "cursor") return { permissionMode };
  return asCursorMode(permissionMode) === mode
    ? { permissionMode }
    : { permissionMode, providerMode: mode };
}

function unknownProvider(provider: never): never {
  throw new Error(`Unknown provider: ${String(provider)}`);
}
