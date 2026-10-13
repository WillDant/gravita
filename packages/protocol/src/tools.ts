// Zod-free helpers about tool calls that every provider's adapter, the engine and the UI
// share: one-line previews, the target of a call, a stable JSON for hashing, and the
// provider-neutral shape the engine's guards judge (`GuardedCall`).

type Input = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** What a tool call works on, as `tool.started` events carry it. */
export interface ToolTarget {
  path?: string;
  cmd?: string;
  url?: string;
  query?: string;
  agentType?: string;
}

/**
 * The target of a tool input in the common JSON spellings (`file_path`, `command`, `url`,
 * `query`…). A provider whose inputs are shaped otherwise builds its `ToolTarget` itself.
 */
export function toolTarget(input: Input): ToolTarget {
  const target: ToolTarget = {};
  const path = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path);
  if (path) target.path = path;
  const cmd = str(input.command);
  if (cmd) target.cmd = cmd;
  const url = str(input.url);
  if (url) target.url = url;
  const query = str(input.query) ?? str(input.pattern);
  if (query) target.query = query;
  const agentType = str(input.subagent_type);
  if (agentType) target.agentType = agentType;
  return target;
}

/** Events carry previews, never full texts: this many characters at most. */
export const PREVIEW_CHARS = 240;

/** One line of at most `max` characters, whitespace collapsed. */
export function preview(text: string, max = PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Short human-readable summary of a tool input, preferring the agent's own description. */
export function inputPreview(input: Input): string {
  const t = toolTarget(input);
  const parts = [str(input.description), t.cmd, t.path, t.url, t.query, str(input.prompt)].filter(
    (p): p is string => Boolean(p),
  );
  return preview(parts[0] ?? JSON.stringify(input));
}

/** JSON with object keys sorted, so equal inputs always serialise (and hash) the same. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * What a guarded tool call does, whatever the provider calls the tool:
 * - `read`: only reads, or only organises the agent's own work (todos, subagents);
 * - `edit`: writes the files in `paths`;
 * - `shell`: runs `command`;
 * - `web`: fetches or searches the web;
 * - `ask`: asks the user a question;
 * - `gravita`: one of the role tools Gravita serves;
 * - `other`: anything else (another MCP server's tool…).
 */
export type GuardedKind = "read" | "edit" | "shell" | "web" | "ask" | "gravita" | "other";

/**
 * A tool call as the engine's ownership guard and autonomy policy judge it. Each provider
 * has an adapter from its own calls to this shape, so the rules never name a provider's tools.
 */
export interface GuardedCall {
  kind: GuardedKind;
  /** Files the call reads or writes; relative ones resolve from `cwd`. */
  paths: string[];
  /** The command line of a `shell` call. */
  command?: string;
  /** The provider's own name for the tool (for logs). */
  tool: string;
  /** Set when a subagent makes the call. */
  agentId?: string;
  /** The agent's working directory at the time of the call. */
  cwd?: string;
}
