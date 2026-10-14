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

/**
 * The tools a code-mode script calls (`await tools.exec_command({cmd: "…"})`,
 * `tools.apply_patch("*** Begin Patch…")`, `tools.mcp__gravita__complete_task(…)`), in order,
 * so the map shows what the script does and not the script. Only literal strings are read;
 * a command built at run time leaves `cmd` out.
 */
export function codeModeCalls(script: string): CodeModeCall[] {
  const reader = new ScriptReader(script);
  const out: CodeModeCall[] = [];
  for (const m of script.matchAll(CODE_MODE_CALL)) {
    const tool = m[1]!;
    const arg = (m.index ?? 0) + m[0].length;
    const call: CodeModeCall = { tool };
    if (tool === "exec_command") {
      const cmd = reader.cmdField(arg);
      if (cmd) call.cmd = cmd;
    } else if (tool === APPLY_PATCH) {
      const patch = reader.literal(arg)?.value;
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

/** A string literal read from a script: its value, and the index just past it. */
interface Literal {
  value: string;
  end: number;
}

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  v: "\v",
  "0": "\0",
};
const HEX = /^[0-9a-fA-F]+$/;
const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r";
const isIdent = (c: string) =>
  (c >= "a" && c <= "z") ||
  (c >= "A" && c <= "Z") ||
  (c >= "0" && c <= "9") ||
  c === "_" ||
  c === "$";
/** How far into an object `cmdField` looks (strings count once, whatever their length). */
const OBJECT_SCAN_LIMIT = 256;
/** How deeply nested a value before `cmd` may be. */
const MAX_DEPTH = 8;

/**
 * Reads the JS string literals of one script, each decoded once. A literal that can't be
 * read (unterminated, a bad escape, or a template with `${…}`) fails at some point, and so
 * does any literal of the same quote opened inside it, so that is remembered: a script full
 * of broken quotes still reads in linear time.
 */
class ScriptReader {
  private readonly decoded = new Map<number, Literal | undefined>();
  /** Per quote, the widest stretch a literal failed over: [opened at, failed at]. */
  private readonly failed: Record<string, [number, number]> = {};

  constructor(private readonly src: string) {}

  /** The string literal opening at `i`, if there is one. */
  literal(i: number): Literal | undefined {
    const quote = this.src[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") return undefined;
    const failed = this.failed[quote];
    if (failed && i > failed[0] && i < failed[1]) return undefined;
    if (this.decoded.has(i)) return this.decoded.get(i);
    const lit = this.decode(i, quote);
    this.decoded.set(i, lit);
    return lit;
  }

  private decode(start: number, quote: string): Literal | undefined {
    const src = this.src;
    let value = "";
    let run = start + 1;
    let i = run;
    const fail = () => {
      const prev = this.failed[quote];
      if (!prev || i > prev[1]) this.failed[quote] = [start, i];
      return undefined;
    };
    while (i < src.length) {
      const c = src[i]!;
      if (c === quote) return { value: value + src.slice(run, i), end: i + 1 };
      if (c === "\\") {
        value += src.slice(run, i);
        const esc = this.escape(i + 1);
        if (!esc) return fail();
        value += esc.value;
        i = run = esc.end;
        continue;
      }
      if (quote === "`") {
        // A template with a substitution is built at run time.
        if (c === "$" && src[i + 1] === "{") return fail();
        // Its raw line breaks are part of it, CRLF read as LF.
        if (c === "\r") {
          value += `${src.slice(run, i)}\n`;
          i = run = src[i + 1] === "\n" ? i + 2 : i + 1;
          continue;
        }
      } else if (c === "\n" || c === "\r") return fail();
      i++;
    }
    return fail();
  }

  /** The escape sequence whose backslash is at `i - 1`. */
  private escape(i: number): Literal | undefined {
    const src = this.src;
    const c = src[i];
    if (c === undefined) return undefined;
    if (c === "x") {
      const hex = src.slice(i + 1, i + 3);
      return hex.length === 2 && HEX.test(hex)
        ? { value: String.fromCharCode(Number.parseInt(hex, 16)), end: i + 3 }
        : undefined;
    }
    if (c === "u" && src[i + 1] === "{") {
      const close = src.indexOf("}", i + 2);
      const hex = close < 0 ? "" : src.slice(i + 2, close);
      const code = hex.length <= 6 && HEX.test(hex) ? Number.parseInt(hex, 16) : -1;
      return code >= 0 && code <= 0x10ffff
        ? { value: String.fromCodePoint(code), end: close + 1 }
        : undefined;
    }
    if (c === "u") {
      const hex = src.slice(i + 1, i + 5);
      return hex.length === 4 && HEX.test(hex)
        ? { value: String.fromCharCode(Number.parseInt(hex, 16)), end: i + 5 }
        : undefined;
    }
    // A line continuation adds nothing.
    if (c === "\r") return { value: "", end: src[i + 1] === "\n" ? i + 2 : i + 1 };
    if (c === "\n" || c === " " || c === " ") return { value: "", end: i + 1 };
    // `\'`, `\"`, `` \` ``, `\\` and any other character stand for themselves.
    return { value: ESCAPES[c] ?? c, end: i + 1 };
  }

  /**
   * The `cmd` of the object literal opening at `i` (`{workdir: "/x", cmd: "ls"}`), when it
   * is a literal string. Scans the object's own keys up to its closing brace, stepping over
   * strings and nested values; gives up on a string it can't read, or after a while.
   */
  cmdField(i: number): string | undefined {
    const src = this.src;
    if (src[i] !== "{") return undefined;
    let depth = 0;
    // A key starts right after the object's own `{` or `,`.
    let atKey = false;
    for (let j = i, steps = 0; j < src.length && steps < OBJECT_SCAN_LIMIT; steps++) {
      const c = src[j]!;
      if (isSpace(c)) {
        j++;
        continue;
      }
      let isCmd = false;
      let end = j + 1;
      if (c === '"' || c === "'" || c === "`") {
        const lit = this.literal(j);
        if (!lit) return undefined;
        isCmd = c !== "`" && lit.value === "cmd";
        end = lit.end;
      } else if (isIdent(c)) {
        while (end < src.length && isIdent(src[end]!)) end++;
        isCmd = end - j === 3 && src.startsWith("cmd", j);
      } else if (c === "{" || c === "[" || c === "(") {
        if (++depth > MAX_DEPTH) return undefined;
      } else if ((c === "}" || c === "]" || c === ")") && --depth === 0) return undefined;
      if (isCmd && atKey && depth === 1) {
        const value = this.valueAfterColon(end);
        if (value !== null) return value;
      }
      atKey = depth === 1 && (c === "{" || c === ",");
      j = end;
    }
    return undefined;
  }

  /**
   * After a key ending at `i`: the string after its `:` (undefined when the value isn't a
   * literal string), or null when no `:` follows (it wasn't a key).
   */
  private valueAfterColon(i: number): string | undefined | null {
    const src = this.src;
    let j = i;
    while (j < src.length && isSpace(src[j]!)) j++;
    if (src[j] !== ":") return null;
    j++;
    while (j < src.length && isSpace(src[j]!)) j++;
    return this.literal(j)?.value;
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
