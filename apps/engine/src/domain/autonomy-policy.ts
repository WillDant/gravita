import type { SquadAutonomy } from "@gravita/protocol";
import { basename, simpleCommands } from "./shell-command";

// What a squad session may do without asking, by the autonomy the user picked. Runs after
// the ownership guard (which already denied what no role may do), on the permission prompts
// Claude Code raises: "allow" answers for the user, "ask" sends the prompt to Needs you.

export type PermissionVerdict = "allow" | "ask" | "deny";

/** Tools that only read, or only organise the agent's own work. Never asked in any mode. */
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

const EDIT_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const WEB_TOOLS: ReadonlySet<string> = new Set(["WebFetch", "WebSearch"]);

/** The role tools Gravita serves itself. */
export const GRAVITA_TOOL_PREFIX = "mcp__gravita__";
export const ASK_USER_QUESTION = "AskUserQuestion";

/** Programs that reach the network by themselves. */
const NETWORK_PROGRAMS = new Set([
  "curl",
  "wget",
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "ftp",
  "telnet",
  "nc",
  "ncat",
  "http",
  "https",
  "gh",
  "docker",
  "podman",
  "brew",
  "apt",
  "apt-get",
  "npx",
  "pnpx",
  "bunx",
]);

/** Package managers, and the subcommands of theirs that download or publish. */
const FETCHING_SUBCOMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: new Set([
    "install",
    "i",
    "add",
    "ci",
    "update",
    "up",
    "upgrade",
    "publish",
    "exec",
    "x",
    "create",
    "init",
    "dlx",
  ]),
  pnpm: new Set([
    "add",
    "install",
    "i",
    "update",
    "up",
    "upgrade",
    "dlx",
    "publish",
    "create",
    "fetch",
  ]),
  yarn: new Set(["add", "install", "upgrade", "up", "dlx", "publish", "create", "global"]),
  bun: new Set(["add", "install", "i", "update", "upgrade", "x", "create", "publish"]),
  pip: new Set(["install", "download"]),
  pip3: new Set(["install", "download"]),
  uv: new Set(["add", "sync", "pip", "tool", "install", "lock"]),
  cargo: new Set(["add", "install", "fetch", "update", "publish"]),
  go: new Set(["get", "install", "mod"]),
  gem: new Set(["install", "update"]),
  bundle: new Set(["install", "update"]),
  deno: new Set(["install", "add", "cache"]),
  composer: new Set(["install", "require", "update"]),
  git: new Set(["push", "fetch", "pull", "clone", "ls-remote", "submodule"]),
};

/** Package managers whose bare form installs. */
const BARE_INSTALLS = new Set(["yarn", "pnpm", "bun"]);

function fetches(argv: readonly string[]): boolean {
  const head = argv[0];
  if (head === undefined) return false;
  const prog = basename(head);
  if (NETWORK_PROGRAMS.has(prog)) return true;
  // "python -m pip install …"
  if ((prog === "python" || prog === "python3") && argv[1] === "-m" && argv[2]?.startsWith("pip"))
    return argv.slice(3).some((a) => a === "install" || a === "download");
  const subs = FETCHING_SUBCOMMANDS[prog];
  if (!subs) return false;
  const sub = argv.slice(1).find((a) => !a.startsWith("-"));
  if (sub === undefined) return BARE_INSTALLS.has(prog);
  return subs.has(sub);
}

/** True when a Bash line would reach the network or install packages. */
export function isNetworkCommand(command: string): boolean {
  return simpleCommands(command).some((c) => fetches(c.argv));
}

/**
 * A role session's answer to a permission prompt:
 * - `auto`: everything the guard let through, except AskUserQuestion (always the user's);
 * - `guarded`: edits, reads and local commands; network and installs go to the user;
 * - `ask`: only reading is automatic, everything else goes to the user.
 * Gravita's own role tools are always allowed.
 */
export function rolePermission(
  autonomy: SquadAutonomy,
  toolName: string,
  input: Record<string, unknown>,
): PermissionVerdict {
  if (toolName.startsWith(GRAVITA_TOOL_PREFIX)) return "allow";
  if (toolName === ASK_USER_QUESTION) return "ask";
  if (READ_ONLY_TOOLS.has(toolName)) return "allow";
  if (autonomy === "auto") return "allow";
  if (autonomy === "ask") return "ask";
  if (EDIT_TOOLS.has(toolName)) return "allow";
  if (WEB_TOOLS.has(toolName)) return "ask";
  if (toolName === "Bash") {
    const command = input.command;
    return typeof command === "string" && !isNetworkCommand(command) ? "allow" : "ask";
  }
  return "ask";
}

/** The planner reads the repository and nothing else; it never asks the user mid-plan. */
export function plannerPermission(toolName: string): PermissionVerdict {
  return PLANNER_TOOLS.includes(toolName) ? "allow" : "deny";
}

export const PLANNER_TOOLS: readonly string[] = ["Read", "Grep", "Glob"];
export const PLANNER_DISALLOWED_TOOLS: readonly string[] = [
  "Write",
  "Edit",
  "NotebookEdit",
  "Bash",
  "MultiEdit",
];

/** Claude Code's own mode for a role session: edits are accepted unless the user wants to see each. */
export function rolePermissionMode(autonomy: SquadAutonomy): "acceptEdits" | "default" {
  return autonomy === "ask" ? "default" : "acceptEdits";
}
