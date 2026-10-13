// Loose shapes of Claude Code transcript records (~/.claude/projects/**.jsonl).
// The format is undocumented and changes between CLI versions, so parsing is an
// allowlist: we read only the fields we need and ignore everything else.
// Never read credential-bearing records (e.g. attachment type "credential_org").

export interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
  thinking?: string;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface RawRecord {
  type: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  agentId?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  entrypoint?: string;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: string | ContentBlock[];
    stop_reason?: string | null;
    usage?: Usage;
  };
  toolUseResult?: unknown;
  attachment?: { type?: string; taskId?: string; taskType?: string; status?: string };
  operation?: string;
  content?: unknown;
  customTitle?: string;
  aiTitle?: string;
  compactMetadata?: { trigger?: string; preTokens?: number };
  error?: unknown;
  totalCostUSD?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

/** Parses one JSONL line. Returns null for blank or malformed lines (never throws). */
export function parseLine(line: string): RawRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value && typeof value === "object" && typeof (value as RawRecord).type === "string") {
      return value as RawRecord;
    }
  } catch {
    // Partial line while a file is being written, or corruption: skip.
  }
  return null;
}

export function parseLines(text: string): RawRecord[] {
  const out: RawRecord[] = [];
  for (const line of text.split("\n")) {
    const r = parseLine(line);
    if (r) out.push(r);
  }
  return out;
}

/** Subagent ids look like "a" + 16 hex chars. Background bash task ids do not. */
export const AGENT_ID = /^a[0-9a-f]{16}$/;

export interface TaskNotification {
  taskId: string;
  status: string;
  summary?: string;
}

/** Extracts fields from a `<task-notification>` block (background agent completion). */
export function parseTaskNotification(text: string): TaskNotification | null {
  if (!text.includes("<task-notification>")) return null;
  const pick = (tag: string) =>
    text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim();
  const taskId = pick("task-id");
  const status = pick("status");
  if (!taskId || !status) return null;
  const summary = pick("summary");
  return summary ? { taskId, status, summary } : { taskId, status };
}
