import type { ToolKind } from "@gravita/protocol";

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

type Input = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export interface ToolTarget {
  path?: string;
  cmd?: string;
  url?: string;
  query?: string;
  agentType?: string;
}

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

export const PREVIEW_CHARS = 240;

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
