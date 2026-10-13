// Loose shapes of Codex rollout records ($CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl).
// The format is undocumented and changes between CLI versions, so parsing is an allowlist:
// each reader picks the few fields it needs, checks their types, and ignores everything
// else. Nothing here throws on unexpected input.

/** One line of a rollout: `{timestamp, ordinal?, type, payload}`. */
export interface RolloutLine {
  type: string;
  timestamp?: string;
  payload: Loose;
}

export type Loose = Record<string, unknown>;

export const isObject = (v: unknown): v is Loose =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const str = (o: Loose | undefined, key: string): string | undefined => {
  const v = o?.[key];
  return typeof v === "string" && v ? v : undefined;
};

export const num = (o: Loose | undefined, key: string): number | undefined => {
  const v = o?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};

export const obj = (o: Loose | undefined, key: string): Loose | undefined => {
  const v = o?.[key];
  return isObject(v) ? v : undefined;
};

/** Parses one JSONL line. Null for blank, malformed or unknown-shaped lines (never throws). */
export function parseRolloutLine(line: string): RolloutLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (!isObject(value) || typeof value.type !== "string") return null;
    return {
      type: value.type,
      ...(typeof value.timestamp === "string" ? { timestamp: value.timestamp } : {}),
      payload: isObject(value.payload) ? value.payload : {},
    };
  } catch {
    // A partial line while the file is being written, or corruption: skip.
    return null;
  }
}

export function parseRolloutLines(text: string): RolloutLine[] {
  const out: RolloutLine[] = [];
  for (const line of text.split("\n")) {
    const r = parseRolloutLine(line);
    if (r) out.push(r);
  }
  return out;
}

/** Codex thread ids are UUIDs (v7 since 2025); they also end every rollout file name. */
export const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `rollout-<local time>-<thread id>.jsonl`, optionally zstd-compressed. */
export const ROLLOUT_FILE =
  /^rollout-.+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(\.zst)?$/i;

/** The thread id in a rollout file name, or undefined when it isn't one. */
export function threadIdOfFile(name: string): string | undefined {
  return name.match(ROLLOUT_FILE)?.[1]?.toLowerCase();
}

/**
 * What a thread is to Gravita:
 * - `root`: a session the user started (CLI, exec, IDE, desktop app…);
 * - `subagent`: an agent another thread spawned (`source.subagent.thread_spawn`);
 * - `internal`: a thread Codex runs for itself, like the guardian that reviews approvals or
 *   a compaction/review helper. It replays its parent's context, so it isn't shown.
 */
export type ThreadRole = "root" | "subagent" | "internal";

/** The first record of a rollout, read through an allowlist. */
export interface SessionMeta {
  threadId: string;
  role: ThreadRole;
  ts?: string;
  cwd?: string;
  cliVersion?: string;
  /** Which client started it ("codex_cli_rs", "codex_exec", "Codex Desktop"…). */
  originator?: string;
  gitBranch?: string;
  /** The thread that spawned this one (subagents and internal threads). */
  parentThreadId?: string;
  /** The top thread of the tree, when Codex records it (`session_id`). */
  rootThreadId?: string;
  /** Spawn details of a subagent. */
  spawn?: { depth?: number; nickname?: string; role?: string };
}

/** `session_meta` → `SessionMeta`; null when the record isn't one or lacks a thread id. */
export function sessionMetaOf(r: RolloutLine): SessionMeta | null {
  if (r.type !== "session_meta") return null;
  const p = r.payload;
  const threadId = str(p, "id")?.toLowerCase();
  if (!threadId || !THREAD_ID.test(threadId)) return null;
  const source = p.source;
  const sub = isObject(source) ? source.subagent : undefined;
  const spawn = isObject(sub) ? obj(sub, "thread_spawn") : undefined;
  const role: ThreadRole = spawn ? "subagent" : sub !== undefined ? "internal" : "root";
  const parent = (str(spawn, "parent_thread_id") ?? str(p, "parent_thread_id"))?.toLowerCase();
  const root = str(p, "session_id")?.toLowerCase();
  const meta: SessionMeta = { threadId, role };
  const ts = str(p, "timestamp") ?? r.timestamp;
  if (ts) meta.ts = ts;
  const cwd = str(p, "cwd");
  if (cwd) meta.cwd = cwd;
  const cliVersion = str(p, "cli_version");
  if (cliVersion) meta.cliVersion = cliVersion;
  const originator = str(p, "originator");
  if (originator) meta.originator = originator;
  const gitBranch = str(obj(p, "git"), "branch");
  if (gitBranch) meta.gitBranch = gitBranch;
  if (parent && THREAD_ID.test(parent) && parent !== threadId) meta.parentThreadId = parent;
  if (root && THREAD_ID.test(root) && root !== threadId) meta.rootThreadId = root;
  if (spawn) {
    const depth = num(spawn, "depth");
    const nickname = str(spawn, "agent_nickname");
    const agentRole = str(spawn, "agent_role");
    meta.spawn = {
      ...(depth !== undefined ? { depth } : {}),
      ...(nickname ? { nickname } : {}),
      ...(agentRole ? { role: agentRole } : {}),
    };
  }
  return meta;
}

/** The text parts of a `message` response item's content. */
export function textParts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const part of content) {
    if (!isObject(part)) continue;
    const t = part.text;
    if (typeof t === "string" && (part.type === undefined || /text/.test(String(part.type))))
      out.push(t);
  }
  return out;
}

/** A context block Codex injects as a user turn: `<tag>…</tag>`, or the AGENTS.md preamble. */
function isInjected(part: string): boolean {
  const t = part.trim();
  if (/^#\s*AGENTS\.md instructions/i.test(t)) return true;
  const open = t.match(/^<([a-z][a-z0-9_-]*)(\s[^>]*)?>/i);
  return Boolean(open && t.endsWith(`</${open[1]}>`));
}

/**
 * What the person typed in a user `message`: its text parts without the context Codex
 * injects (environment, AGENTS.md, aborted-turn notes…). Empty when it was only context.
 */
export function typedText(content: unknown): string {
  return textParts(content)
    .filter((t) => !isInjected(t))
    .join("\n\n")
    .trim();
}
