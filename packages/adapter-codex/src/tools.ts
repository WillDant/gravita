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
  // Code mode's web tool (search and open pages).
  web__run: "web",
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

/** The code-mode script tool: a JS script that runs other tools. */
export const CODE_MODE = "exec";

/** A tool a code-mode script calls, with what Gravita can read of its input. */
export interface CodeModeCall {
  tool: string;
  /** exec_command's `cmd`. */
  cmd?: string;
  /** apply_patch's patch text. */
  patch?: string;
}

const CODE_MODE_CALL = /\btools\.([A-Za-z_]\w*)\(\s*/g;
const STRING_LITERAL = /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\$]|\\.)*`)/;
const CMD_FIELD = /^\{\s*["']?cmd["']?\s*:\s*/;

/**
 * The tools a code-mode script calls (`await tools.exec_command({cmd: "…"})`,
 * `tools.apply_patch("*** Begin Patch…")`, `tools.mcp__gravita__complete_task(…)`), in order,
 * so the map shows what the script does and not the script. Only literal strings are read;
 * a command built at run time leaves `cmd` out.
 */
export function codeModeCalls(script: string): CodeModeCall[] {
  const out: CodeModeCall[] = [];
  for (const m of script.matchAll(CODE_MODE_CALL)) {
    const tool = m[1]!;
    const rest = script.slice((m.index ?? 0) + m[0].length);
    const call: CodeModeCall = { tool };
    if (tool === "exec_command") {
      const field = CMD_FIELD.exec(rest);
      const lit = field && STRING_LITERAL.exec(rest.slice(field[0].length));
      const cmd = lit ? jsString(lit[1]!) : undefined;
      if (cmd) call.cmd = cmd;
    } else if (tool === APPLY_PATCH) {
      const lit = STRING_LITERAL.exec(rest);
      const patch = lit ? jsString(lit[1]!) : undefined;
      if (patch) call.patch = patch;
    }
    out.push(call);
  }
  return out;
}

/** The shell commands a code-mode script runs through `tools.exec_command`. */
export function codeModeCommands(script: string): string[] {
  return codeModeCalls(script).flatMap((c) => (c.cmd ? [c.cmd] : []));
}

/** The patches a code-mode script applies through `tools.apply_patch`, as one patch text. */
export function codeModePatch(script: string): string {
  return codeModeCalls(script)
    .flatMap((c) => (c.patch ? [c.patch] : []))
    .join("\n");
}

/** A JS string literal's value, read as JSON (a single-quoted or template one is requoted). */
function jsString(lit: string): string | undefined {
  const json = lit.startsWith('"')
    ? lit
    : `"${lit
        .slice(1, -1)
        .replace(/\\(['`])/g, "$1")
        .replace(/\n/g, "\\n")
        .replace(/(^|[^\\])"/g, '$1\\"')}"`;
  try {
    return JSON.parse(json) as string;
  } catch {
    // An escape JSON doesn't know: the script's first line stands for the call.
    return undefined;
  }
}

/** One call of a script on one line, and how many more the script makes after it. */
const more = (text: string, calls: number) => (calls > 1 ? `${text} (+${calls - 1})` : text);

/** What a code-mode script is about: its first tool call, read like a call of its own. */
function scriptView(script: string): { kind: ToolKind; target: ToolTarget; preview?: string } {
  const calls = codeModeCalls(script);
  const first = calls[0];
  if (!first) return { kind: "bash", target: {} };
  if (first.cmd !== undefined)
    return { kind: "bash", target: { cmd: preview(more(first.cmd, calls.length)) } };
  if (first.tool === APPLY_PATCH) {
    const files = first.patch ? parsePatch(first.patch) : [];
    const path = files[0]?.path;
    return {
      kind: "edit",
      target: path ? { path } : {},
      ...(files.length
        ? { preview: more(files.map((f) => f.movedTo ?? f.path).join(", "), calls.length) }
        : {}),
    };
  }
  const kind = first.tool === "exec_command" ? "bash" : codexToolKind(first.tool);
  return {
    kind: kind === "other" ? "bash" : kind,
    target: {},
    preview: more(first.tool, calls.length),
  };
}

/**
 * A tool's kind, from its name and, for a code-mode script, from what the script calls (a
 * script that applies a patch is an edit, one that calls an MCP tool is an MCP call).
 */
export function codexToolKindOf(name: string, input: Input | string): ToolKind {
  if (name === CODE_MODE && typeof input === "string") return scriptView(input).kind;
  return codexToolKind(name);
}

/** What a Codex tool call works on, as `tool.started` carries it. */
export function codexToolTarget(name: string, input: Input | string): ToolTarget {
  if (typeof input === "string") {
    if (name === APPLY_PATCH) {
      const path = parsePatch(input)[0]?.path;
      return path ? { path } : {};
    }
    if (name === CODE_MODE) {
      // A command built at run time can't be read: the script's first line stands for it.
      const view = scriptView(input);
      if (Object.keys(view.target).length || view.kind !== "bash") return view.target;
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
    if (name === CODE_MODE) {
      const view = scriptView(input);
      return preview(view.preview ?? view.target.cmd ?? firstLine(input));
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
