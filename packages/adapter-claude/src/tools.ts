import type { ToolKind } from "@gravita/protocol";
import type { GuardedCall, GuardedKind } from "@gravita/protocol/tools";

// Claude Code's tool names, and what they mean to Gravita: the kind a `tool.started`
// event shows, and the provider-neutral `GuardedCall` the engine's guards judge.

// The provider-neutral helpers live in @gravita/protocol/tools; re-exported for callers
// that already import them from here.
export {
  inputPreview,
  PREVIEW_CHARS,
  preview,
  type ToolTarget,
  toolTarget,
} from "@gravita/protocol/tools";

const KIND_BY_NAME: Record<string, ToolKind> = {
  Read: "read",
  NotebookRead: "read",
  Grep: "search",
  Glob: "search",
  LS: "search",
  ToolSearch: "search",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Write: "write",
  Bash: "bash",
  BashOutput: "bash",
  KillShell: "bash",
  Monitor: "bash",
  WebFetch: "web",
  WebSearch: "web",
  Agent: "agent",
  Task: "agent",
  TodoWrite: "todo",
  TaskCreate: "todo",
  TaskUpdate: "todo",
  AskUserQuestion: "ask",
  EnterPlanMode: "plan",
  ExitPlanMode: "plan",
};

export function isAgentTool(name: string): boolean {
  return name === "Agent" || name === "Task";
}

export function toolKind(name: string): ToolKind {
  if (name.startsWith("mcp__")) return "mcp";
  return KIND_BY_NAME[name] ?? "other";
}

/** Claude Code's question tool: its prompts are always the user's to answer. */
export const ASK_USER_QUESTION = "AskUserQuestion";

/** The role tools Gravita serves itself, as Claude Code names them. */
export const GRAVITA_TOOL_PREFIX = "mcp__gravita__";

/** Tools that only read, or only organise the agent's own work. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
  "TodoWrite",
  "ToolSearch",
  "BashOutput",
  "TaskOutput",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
  // Subagents: each of their tool calls is judged on its own.
  "Agent",
  "Task",
]);

/** Tools that write files. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

const WEB_TOOLS: ReadonlySet<string> = new Set(["WebFetch", "WebSearch"]);

function guardedKind(toolName: string): GuardedKind {
  if (toolName.startsWith(GRAVITA_TOOL_PREFIX)) return "gravita";
  if (toolName === ASK_USER_QUESTION) return "ask";
  if (READ_ONLY_TOOLS.has(toolName)) return "read";
  if (EDIT_TOOLS.has(toolName)) return "edit";
  if (WEB_TOOLS.has(toolName)) return "web";
  if (toolName === "Bash") return "shell";
  return "other";
}

/** The file a Claude Code tool input names, if any. */
function filePath(input: Record<string, unknown>): string | undefined {
  for (const key of ["file_path", "notebook_path", "path"]) {
    const v = input[key];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** A Claude Code tool call as the engine's guards judge it. */
export function claudeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  context: { agentId?: string; cwd?: string } = {},
): GuardedCall {
  const kind = guardedKind(toolName);
  const path = kind === "edit" || kind === "read" ? filePath(input) : undefined;
  const command = kind === "shell" && typeof input.command === "string" ? input.command : undefined;
  return {
    kind,
    paths: path === undefined ? [] : [path],
    ...(command !== undefined ? { command } : {}),
    tool: toolName,
    ...(context.agentId ? { agentId: context.agentId } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
  };
}
