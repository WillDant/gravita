import type { ToolKind } from "@gravita/protocol";
import {
  type GuardedCall,
  type GuardedKind,
  inputPreview,
  preview,
  type ToolTarget,
  toolTarget,
} from "@gravita/protocol/tools";
import { parsePatch, patchPaths } from "./patch";

// Codex's tool names, and what they mean to Gravita: the kind a `tool.started` event shows,
// its target, and the provider-neutral `GuardedCall` the engine's guards judge. Names seen
// in Codex 0.160 rollouts and app-server items; unknown ones are "other".

type Input = Record<string, unknown>;

const KIND_BY_NAME: Record<string, ToolKind> = {
  // Shell: the unified exec tool, its stdin, and older spellings.
  exec_command: "bash",
  write_stdin: "bash",
  shell: "bash",
  shell_command: "bash",
  local_shell: "bash",
  container_exec: "bash",
  // Code mode: a script that runs tools, and the wait for a script still running.
  exec: "bash",
  wait: "bash",
  apply_patch: "edit",
  read_file: "read",
  view_image: "read",
  list_dir: "search",
  grep_files: "search",
  web_search: "web",
  web_search_call: "web",
  spawn_agent: "agent",
  update_plan: "todo",
  request_user_input: "ask",
  list_mcp_resources: "mcp",
  list_mcp_resource_templates: "mcp",
  read_mcp_resource: "mcp",
};

/** The tool that starts a subagent (a thread of its own, with its own rollout). */
export const SPAWN_AGENT = "spawn_agent";
/** The plan tool: its steps become the agent's todo list. */
export const UPDATE_PLAN = "update_plan";
/** The patch tool: its input names the files it writes. */
export const APPLY_PATCH = "apply_patch";

/** The role tools Gravita serves itself, as Codex names MCP tools. */
export const GRAVITA_TOOL_PREFIX = "mcp__gravita__";

/**
 * A function call's full name. Codex records some MCP calls as `{namespace: "mcp__server",
 * name: "tool"}`; they become `mcp__server__tool`, like the ones recorded whole.
 */
export function codexToolName(name: string, namespace?: string): string {
  if (namespace?.startsWith("mcp__") && !name.startsWith("mcp__")) return `${namespace}__${name}`;
  return name;
}

export function codexToolKind(name: string): ToolKind {
  if (name.startsWith("mcp__")) return "mcp";
  return KIND_BY_NAME[name] ?? "other";
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** A command given as a string, or as argv (older `shell` calls). */
function commandOf(input: Input): string | undefined {
  for (const key of ["cmd", "command"]) {
    const v = input[key];
    if (typeof v === "string" && v) return v;
    if (Array.isArray(v) && v.every((p) => typeof p === "string") && v.length) {
      // `["bash", "-lc", "<script>"]` is how older versions wrapped every command.
      const argv = v as string[];
      if (argv.length === 3 && /(^|\/)(ba|z)?sh$/.test(argv[0]!) && argv[1] === "-lc")
        return argv[2];
      return argv.join(" ");
    }
  }
  return undefined;
}

/** The patch text of an apply_patch call: the raw custom-tool input, or `{input}`. */
export function patchTextOf(input: Input | string): string {
  if (typeof input === "string") return input;
  return str(input.input) ?? str(input.patch) ?? "";
}

/** The first line of a script, for a one-line target. */
const firstLine = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) ?? "";

/** What a Codex tool call works on, as `tool.started` carries it. */
export function codexToolTarget(name: string, input: Input | string): ToolTarget {
  if (typeof input === "string") {
    if (name === APPLY_PATCH) {
      const path = parsePatch(input)[0]?.path;
      return path ? { path } : {};
    }
    const line = firstLine(input);
    return line ? { cmd: preview(line) } : {};
  }
  switch (name) {
    case APPLY_PATCH: {
      const path = parsePatch(patchTextOf(input))[0]?.path;
      return path ? { path } : {};
    }
    case "write_stdin":
      return {};
    case "read_file":
    case "view_image":
    case "list_dir": {
      const path = str(input.file_path) ?? str(input.path) ?? str(input.dir_path);
      return path ? { path } : {};
    }
    case "grep_files": {
      const target: ToolTarget = {};
      const query = str(input.pattern) ?? str(input.query);
      if (query) target.query = query;
      const path = str(input.path);
      if (path) target.path = path;
      return target;
    }
    case SPAWN_AGENT: {
      const agentType = str(input.agent_type) ?? str(input.agent_role) ?? str(input.role);
      return agentType ? { agentType } : {};
    }
  }
  const cmd = KIND_BY_NAME[name] === "bash" ? commandOf(input) : undefined;
  return cmd ? { cmd } : toolTarget(input);
}

/** One-line summary of a Codex tool input. */
export function codexInputPreview(name: string, input: Input | string): string {
  if (typeof input === "string") {
    if (name === APPLY_PATCH) {
      const files = parsePatch(input);
      return preview(files.map((f) => f.movedTo ?? f.path).join(", ") || firstLine(input));
    }
    return preview(firstLine(input));
  }
  const t = codexToolTarget(name, input);
  if (name === SPAWN_AGENT) {
    const task = str(input.message) ?? str(input.prompt) ?? str(input.task);
    if (task) return preview(task);
  }
  if (name === UPDATE_PLAN) {
    const explanation = str(input.explanation);
    if (explanation) return preview(explanation);
  }
  if (name === "write_stdin") {
    const chars = str(input.chars);
    return preview(chars ? `stdin: ${chars}` : "stdin");
  }
  const first = t.cmd ?? t.path ?? t.query ?? t.url;
  return first ? preview(first) : inputPreview(input);
}

const READ_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "view_image",
  "list_dir",
  "grep_files",
  // Organising the agent's own work; a subagent's own calls are judged on their own.
  UPDATE_PLAN,
  SPAWN_AGENT,
  "wait_agent",
  "send_input",
  "close_agent",
  "resume_agent",
  "list_mcp_resources",
  "list_mcp_resource_templates",
]);

const SHELL_TOOLS: ReadonlySet<string> = new Set([
  "exec_command",
  "shell",
  "shell_command",
  "local_shell",
  "container_exec",
]);

function guardedKind(name: string): GuardedKind {
  if (name.startsWith(GRAVITA_TOOL_PREFIX)) return "gravita";
  if (name === "request_user_input") return "ask";
  if (name === APPLY_PATCH) return "edit";
  if (READ_TOOLS.has(name)) return "read";
  if (SHELL_TOOLS.has(name)) return "shell";
  if (name === "web_search" || name === "web_search_call") return "web";
  // A code-mode script (`exec`) or stdin to a running process can do anything and names no
  // command a guard could read: judged like any unknown tool.
  return "other";
}

/**
 * A Codex tool call as the engine's guards judge it. `input` is the call's parsed
 * arguments, or the raw text of a custom tool (apply_patch's patch).
 */
export function codexToolCall(
  name: string,
  input: Input | string,
  context: { agentId?: string; cwd?: string } = {},
): GuardedCall {
  const kind = guardedKind(name);
  let paths: string[] = [];
  if (kind === "edit") paths = patchPaths(parsePatch(patchTextOf(input)));
  else if (kind === "read" && typeof input !== "string") {
    const path = str(input.file_path) ?? str(input.path) ?? str(input.dir_path);
    if (path) paths = [path];
  }
  const command = kind === "shell" && typeof input !== "string" ? commandOf(input) : undefined;
  return {
    kind,
    paths,
    ...(command !== undefined ? { command } : {}),
    tool: name,
    ...(context.agentId ? { agentId: context.agentId } : {}),
    ...(context.cwd ? { cwd: context.cwd } : {}),
  };
}
