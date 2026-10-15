import type { ToolKind } from "@gravita/protocol";
import { inputPreview, preview, type ToolTarget, toolTarget } from "@gravita/protocol/tools";

// The tool calls of a Cursor transcript, named the way `cursor-agent` names them (`Read`,
// `StrReplace`, `Shell`…), as Gravita's tool kinds. Subagents are not a tool of their own:
// the transcript calls `CallDynamicTool` with `toolName: "Task"`.

const KIND_BY_NAME: Readonly<Record<string, ToolKind>> = {
  Read: "read",
  ReadFile: "read",
  ReadLints: "read",
  Grep: "search",
  Glob: "search",
  SemanticSearch: "search",
  StrReplace: "edit",
  Delete: "edit",
  EditNotebook: "edit",
  Write: "write",
  Shell: "bash",
  WebFetch: "web",
  WebSearch: "web",
  TodoWrite: "todo",
  Task: "agent",
  CreatePlan: "plan",
  AskQuestion: "ask",
};

/** Lookups of the agent's own tools: bookkeeping, not work worth a station on the map. */
const SILENT = new Set(["GetDynamicTools"]);

/** The task a `Task` call hands to a subagent. */
export interface TaskCall {
  description: string;
  subagentType: string;
  prompt: string;
  background: boolean;
}

export interface TranscriptTool {
  name: string;
  kind: ToolKind;
  target: ToolTarget;
  inputPreview: string;
  /** Set for a call that starts a subagent. */
  task?: TaskCall;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const record = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function taskOf(args: Record<string, unknown>): TaskCall {
  return {
    description: str(args.description) ?? "",
    subagentType: str(args.subagent_type) ?? "generalPurpose",
    prompt: str(args.prompt) ?? "",
    background: args.run_in_background === true,
  };
}

function taskTool(task: TaskCall, args: Record<string, unknown>): TranscriptTool {
  return {
    name: "Task",
    kind: "agent",
    target: toolTarget(args),
    inputPreview: preview(task.description || task.prompt),
    task,
  };
}

/** A tool call as Gravita shows it; undefined for the agent's own bookkeeping calls. */
export function transcriptTool(
  name: string,
  input: Record<string, unknown>,
): TranscriptTool | undefined {
  if (SILENT.has(name)) return undefined;
  if (name === "CallDynamicTool") {
    const namespace = str(input.namespace) ?? "cursor";
    const toolName = str(input.toolName) ?? "tool";
    const args = record(input.arguments);
    if (toolName === "Task") return taskTool(taskOf(args), args);
    return {
      name: `mcp__${namespace}__${toolName}`,
      kind: "mcp",
      target: toolTarget(args),
      inputPreview: inputPreview(args),
    };
  }
  if (name === "Task") return taskTool(taskOf(input), input);
  return {
    name,
    kind: KIND_BY_NAME[name] ?? "other",
    target: toolTarget(input),
    inputPreview: inputPreview(input),
  };
}

/** The items of a `TodoWrite` call, for `todo.updated`. */
export function todoItems(input: Record<string, unknown>): { content: string; status: string }[] {
  const todos = Array.isArray(input.todos) ? input.todos : [];
  return todos.flatMap((t) => {
    const item = record(t);
    const content = str(item.content);
    return content ? [{ content, status: str(item.status) ?? "pending" }] : [];
  });
}
