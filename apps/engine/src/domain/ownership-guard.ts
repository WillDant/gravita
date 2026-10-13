import { isAbsolute, relative, resolve, sep } from "node:path";
import { isShared, normalizePath, outsideOwnership, ownerOf } from "@gravita/core";
import type { SquadPlan } from "@gravita/protocol";
import { basename, type ShellCommand, simpleCommands } from "./shell-command";

// The first ownership layer: a veto on each tool call of a role session (and of its
// subagents) before it runs. It keeps a role's edits inside its worktree and its paths, and
// git in Gravita's hands. The commit gate stays the layer that counts; this one saves the
// agent a wasted turn by saying, at the moment it matters, what to do instead.

export interface OwnershipScope {
  plan: SquadPlan;
  roleId: string;
  /** The role's worktree, and other spellings of it (its real path: /var vs /private/var). */
  roots: readonly string[];
}

export interface GuardedCall {
  toolName: string;
  input: Record<string, unknown>;
  agentId?: string;
  cwd?: string;
}

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Git subcommands that only read. */
const READ_ONLY_GIT = new Set([
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "annotate",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "grep",
  "describe",
  "shortlog",
  "cat-file",
  "merge-base",
  "show-ref",
  "check-ignore",
  "whatchanged",
  "help",
  "version",
]);

/** Global options of git that take a value as the next word. */
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/** `git branch` options that change branches. */
const BRANCH_MUTATIONS = new Set([
  "-d",
  "-D",
  "--delete",
  "-m",
  "-M",
  "--move",
  "-c",
  "-C",
  "--copy",
  "-f",
  "--force",
  "-u",
  "--set-upstream-to",
  "--unset-upstream",
  "--edit-description",
  "--track",
]);
/** `git branch` options that take a value (a commit or a pattern), which is not a new branch. */
const BRANCH_VALUE_OPTIONS = new Set([
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
  "--points-at",
  "--sort",
  "--format",
]);

const DEV_FILES = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty"]);

/** The path relative to the worktree it is in, or undefined when it is outside every root. */
function insideRoots(roots: readonly string[], abs: string): string | undefined {
  for (const root of roots) {
    const rel = relative(root, abs);
    if (rel === "") return "";
    if (!rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
  }
  return undefined;
}

const roleOf = (s: OwnershipScope) => s.plan.roles.find((r) => r.id === s.roleId);
const ownsText = (s: OwnershipScope) => roleOf(s)?.owns.join(", ") ?? "nothing";

/** Why a role may not write `abs`, or undefined when it may. */
function writeDenial(s: OwnershipScope, abs: string): string | undefined {
  const root = s.roots[0] ?? "";
  const rel = insideRoots(s.roots, abs);
  if (rel === undefined)
    return `${abs} is outside your worktree. You work only in ${root}; keep every change there.`;
  const path = normalizePath(rel);
  if (path === "" || path === ".git" || path.startsWith(".git/"))
    return `${path || "The worktree root"} is Gravita's (git metadata). Change only files inside what you own (${ownsText(s)}).`;
  if (isShared(s.plan, path))
    return `${path} is shared: Gravita regenerates it after each merge, so no role edits it. Change your own files (${ownsText(s)}), or call yield_blocked if the task can't be done without it.`;
  if (!outsideOwnership(s.plan, s.roleId, [path]).length) return undefined;
  const owner = ownerOf(s.plan, path);
  if (owner) {
    const prefix = s.plan.roles.find((r) => r.id === owner)?.owns.join(", ") ?? path;
    return `${owner} owns ${prefix} — ask ${owner} with request_change (you own ${ownsText(s)}).`;
  }
  return `${path} isn't in what you own (${ownsText(s)}) and no role owns it. Keep your changes inside your paths, or call yield_blocked to ask the user.`;
}

function filePath(input: Record<string, unknown>): string | undefined {
  for (const key of ["file_path", "notebook_path", "path"]) {
    const v = input[key];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** Why a git invocation may not run, or undefined for read-only git. */
function gitDenial(argv: readonly string[], cwd: string, s: OwnershipScope): string | undefined {
  let i = 1;
  while (i < argv.length) {
    const a = argv[i] as string;
    if (!a.startsWith("-")) break;
    const [flag, inline] = a.split("=", 2) as [string, string | undefined];
    if (GIT_VALUE_OPTIONS.has(flag)) {
      const value = inline ?? argv[i + 1];
      if (
        flag !== "-c" &&
        value !== undefined &&
        insideRoots(s.roots, resolve(cwd, value)) === undefined
      )
        return `git ${flag} ${value} points outside your worktree; run git only in ${s.roots[0]}.`;
      i += inline === undefined ? 2 : 1;
    } else i++;
  }
  const sub = argv[i];
  if (sub === undefined || sub === "--version") return undefined;
  const rest = argv.slice(i + 1);
  if (READ_ONLY_GIT.has(sub) || readOnlyForm(sub, rest)) return undefined;
  return `git ${sub} changes the repository, and in a squad git is Gravita's: it commits your work when you call complete_task and merges it into integration. Leave your changes in the worktree; read-only git (status, diff, log, show) is fine.`;
}

/**
 * Subcommands that only read in some forms (listing branches, tags, stashes…), and the ones
 * that only put files of the worktree back (so a role can undo a change it shouldn't have made).
 */
function readOnlyForm(sub: string, rest: readonly string[]): boolean {
  const first = rest[0];
  switch (sub) {
    case "restore":
      return !rest.some((a) => a.startsWith("--source") || a === "-s");
    case "checkout":
      // "git checkout -- <paths>" restores files; any other form moves HEAD.
      return first === "--";
    case "branch":
      return branchListsOnly(rest);
    case "tag":
      return first === undefined || first === "-l" || first === "--list" || /^-n\d*$/.test(first);
    case "stash":
    case "worktree":
      return first === "list" || (sub === "stash" && first === "show");
    case "remote":
      return rest.every((a) => a === "-v" || a === "--verbose");
    case "config":
      return rest.some((a) => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(a));
    case "reflog":
      return first === undefined || first === "show" || first.startsWith("-");
    default:
      return false;
  }
}

function branchListsOnly(rest: readonly string[]): boolean {
  const listing = rest.includes("--list") || rest.includes("-l");
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    const flag = a.split("=", 1)[0] as string;
    if (BRANCH_MUTATIONS.has(flag)) return false;
    if (BRANCH_VALUE_OPTIONS.has(flag)) {
      if (!a.includes("=")) i++;
      continue;
    }
    // A bare name creates a branch, unless it is a --list pattern.
    if (!a.startsWith("-") && !listing) return false;
  }
  return true;
}

/** A path argument the guard can't resolve: an expansion, the home folder. */
const unresolvable = (p: string) => p.includes("$") || p.startsWith("~");

function bashDenial(command: string, startCwd: string, s: OwnershipScope): string | undefined {
  let cwd = startCwd;
  for (const c of simpleCommands(command)) {
    const denied = commandDenial(c, cwd, s);
    if (denied) return denied;
    // Follow `cd` so a later "rm -rf .." is judged from where it would run.
    const prog = c.argv[0] ? basename(c.argv[0]) : "";
    if (prog === "cd" || prog === "pushd") {
      const target = c.argv.slice(1).find((a) => !a.startsWith("-"));
      if (target) cwd = resolve(cwd, target);
    }
  }
  return undefined;
}

function commandDenial(c: ShellCommand, cwd: string, s: OwnershipScope): string | undefined {
  const root = s.roots[0] ?? "";
  for (const target of c.writes) {
    if (DEV_FILES.has(target)) continue;
    if (unresolvable(target) || insideRoots(s.roots, resolve(cwd, target)) === undefined)
      return `Writing to ${target} would leave your worktree; write only inside ${root}.`;
  }
  const head = c.argv[0];
  if (head === undefined) return undefined;
  const prog = basename(head);
  const args = c.argv.slice(1);

  if (prog === "git") return gitDenial(c.argv, cwd, s);

  if (prog === "cd" || prog === "pushd") {
    const target = args.find((a) => !a.startsWith("-") || a === "-");
    if (target === undefined || target === "-" || unresolvable(target))
      return `${target === undefined ? "cd" : `cd ${target}`} would leave your worktree; stay in ${root} and use paths inside it.`;
    if (insideRoots(s.roots, resolve(cwd, target)) === undefined)
      return `cd ${target} leaves your worktree; stay in ${root}.`;
    return undefined;
  }

  if (prog === "rm" && args.some(isRecursiveFlag)) {
    for (const a of args) {
      if (a.startsWith("-")) continue;
      if (unresolvable(a)) return `rm ${a}: use a plain path inside your worktree (${root}).`;
      const rel = insideRoots(s.roots, resolve(cwd, a));
      if (rel === undefined)
        return `rm ${a} reaches outside your worktree; delete only inside ${root}.`;
      const path = normalizePath(rel);
      if (path === "" || path === ".git" || path.startsWith(".git/"))
        return `rm ${a} would delete your worktree or its git metadata; delete only files inside what you own (${ownsText(s)}).`;
    }
  }
  return undefined;
}

const isRecursiveFlag = (a: string) =>
  a === "--recursive" || (/^-[a-zA-Z]+$/.test(a) && /[rR]/.test(a));

/**
 * Why a role session may not make this tool call, or undefined to let it through. File
 * edits must stay in the worktree and the role's paths (never shared files); Bash may not
 * change git state, `cd` out of the worktree, `rm -r` outside it, or redirect output there.
 */
export function guardToolCall(s: OwnershipScope, call: GuardedCall): string | undefined {
  const cwd = call.cwd ?? s.roots[0] ?? "/";
  let reason: string | undefined;
  if (FILE_TOOLS.has(call.toolName)) {
    const p = filePath(call.input);
    if (p !== undefined) reason = writeDenial(s, resolve(cwd, p));
  } else if (call.toolName === "Bash") {
    const command = call.input.command;
    if (typeof command === "string") reason = bashDenial(command, cwd, s);
  }
  if (reason && call.agentId) return `${reason} (asked by subagent ${call.agentId})`;
  return reason;
}
