import type { ToolKind } from "@gravita/protocol";
import {
  type GuardedCall,
  type GuardedKind,
  preview,
  type ToolTarget,
} from "@gravita/protocol/tools";
import type { ToolCall } from "./acp/types";

// Cursor's tool calls in Gravita's terms. ACP says what a call does (`kind`: read, edit,
// execute, fetch…), what it works on (`locations`, `rawInput`) and gives it a title; Cursor's
// own tool name rides along in `rawInput._toolName` for some tools (task, todos, questions).
// An MCP tool's title is "<server>: <tool>".

type Loose = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

const inputOf = (call: ToolCall): Loose =>
  call.rawInput && typeof call.rawInput === "object" && !Array.isArray(call.rawInput)
    ? (call.rawInput as Loose)
    : {};

/** Cursor's own name for the tool, when it tells. */
const ownName = (call: ToolCall) => str(inputOf(call)._toolName);

const MCP_TITLE = /^([\w.-]+): ([\w.-]+)$/;

/** The MCP server and tool of a call, when its title names them. */
function mcpOf(call: ToolCall): { server: string; tool: string } | undefined {
  if (call.kind !== undefined && call.kind !== "other") return undefined;
  if (ownName(call)) return undefined;
  const m = MCP_TITLE.exec(call.title?.trim() ?? "");
  return m ? { server: m[1]!, tool: m[2]! } : undefined;
}

/** The name Gravita shows for a call: Cursor's tool name, an MCP tool's, or the kind. */
export function cursorToolName(call: ToolCall): string {
  const own = ownName(call);
  if (own) return own;
  const mcp = mcpOf(call);
  if (mcp) return `mcp__${mcp.server}__${mcp.tool}`;
  switch (call.kind) {
    case "execute":
      return "shell";
    case undefined:
      return "other";
    default:
      return call.kind;
  }
}

/** Cursor tool names Gravita recognizes when `rawInput` carries them. */
const NAMED_KINDS: Readonly<Record<string, { tool: ToolKind; guarded: GuardedKind }>> = {
  task: { tool: "agent", guarded: "read" },
  updateTodos: { tool: "todo", guarded: "read" },
  todoWrite: { tool: "todo", guarded: "read" },
  askQuestion: { tool: "ask", guarded: "ask" },
  createPlan: { tool: "plan", guarded: "read" },
};

/** What a call is in Gravita's tool kinds (the line map's icons). */
export function cursorToolKind(call: ToolCall): ToolKind {
  const named = NAMED_KINDS[ownName(call) ?? ""];
  if (named) return named.tool;
  switch (call.kind) {
    case "read":
      return "read";
    case "edit":
    case "delete":
    case "move":
      return "edit";
    case "search":
      return "search";
    case "execute":
      return "bash";
    case "fetch":
      return "web";
    case "switch_mode":
      return "plan";
    default:
      return mcpOf(call) ? "mcp" : "other";
  }
}

function guardedKindOf(call: ToolCall): GuardedKind {
  const named = NAMED_KINDS[ownName(call) ?? ""];
  if (named) return named.guarded;
  switch (call.kind) {
    case "read":
    case "search":
    case "think":
    case "switch_mode":
      return "read";
    case "edit":
    case "delete":
    case "move":
      return "edit";
    case "execute":
      return "shell";
    case "fetch":
      return "web";
    default:
      return mcpOf(call)?.server === "gravita" ? "gravita" : "other";
  }
}

/** The files a call works on: its locations, its input's path, and the files its diffs write. */
export function cursorPaths(call: ToolCall): string[] {
  const input = inputOf(call);
  const out: string[] = [];
  const add = (p: string | undefined) => {
    if (p && !out.includes(p)) out.push(p);
  };
  for (const l of call.locations ?? []) add(str(l?.path));
  add(str(input.path) ?? str(input.file_path) ?? str(input.filePath));
  add(str(input.destination) ?? str(input.newPath));
  for (const c of call.content ?? []) if (c?.type === "diff") add(str(c.path));
  return out;
}

/** A shell call's command: its input's, else its title without the backticks. */
function commandOf(call: ToolCall): string | undefined {
  const input = inputOf(call);
  const cmd = str(input.command) ?? str(input.cmd);
  if (cmd) return cmd;
  const title = call.title?.trim();
  return title ? title.replace(/^`+|`+$/g, "").trim() || undefined : undefined;
}

/** What a call works on, as `tool.started` carries it. */
export function cursorToolTarget(call: ToolCall): ToolTarget {
  const input = inputOf(call);
  const target: ToolTarget = {};
  if (call.kind === "execute") {
    const cmd = commandOf(call);
    if (cmd) target.cmd = cmd;
  }
  const path = cursorPaths(call)[0];
  if (path && call.kind !== "execute") target.path = path;
  const url = str(input.url);
  if (url) target.url = url;
  const query = str(input.pattern) ?? str(input.query) ?? str(input.searchTerm);
  if (query) target.query = query;
  const agentType = str(input.subagentType);
  if (agentType) target.agentType = agentType;
  return target;
}

/** One line about a call, for its card and its permission prompt. */
export function cursorInputPreview(call: ToolCall): string {
  const t = cursorToolTarget(call);
  const input = inputOf(call);
  const text =
    t.cmd ??
    t.path ??
    t.url ??
    t.query ??
    str(input.description) ??
    call.title?.trim() ??
    cursorToolName(call);
  return preview(text);
}

/** A Cursor tool call as the engine's guards judge it. */
export function cursorToolCall(
  call: ToolCall,
  ctx: { agentId?: string; cwd?: string } = {},
): GuardedCall {
  const kind = guardedKindOf(call);
  const command = kind === "shell" ? commandOf(call) : undefined;
  return {
    kind,
    paths: kind === "shell" || kind === "web" || kind === "ask" ? [] : cursorPaths(call),
    ...(command !== undefined ? { command } : {}),
    tool: cursorToolName(call),
    ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
    ...(ctx.cwd ? { cwd: ctx.cwd } : {}),
  };
}
