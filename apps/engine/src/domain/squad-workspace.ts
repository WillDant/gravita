import { join } from "node:path";
import { SquadWorkspaceError } from "./errors";

// Where a squad's worktrees live and what its branches are called. Everything sits under
// Gravita's data dir (never in the user's folder, never under ~/.claude):
//   <worktreesRoot>/<projectId>/<squadId>/integration   on gravita/<squadId>/integration
//   <worktreesRoot>/<projectId>/<squadId>/<roleId>      on gravita/<squadId>/<roleId>

/** Who Gravita's commits are by (passed per command; the user's git config is never written). */
export const GRAVITA_NAME = "Gravita";
export const GRAVITA_EMAIL = "gravita@users.noreply.local";

/** The integration worktree's name; a role can't use it as its id. */
export const INTEGRATION = "integration";

// Ids become path segments and ref components: no separators, dots or leading dashes.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function safe(kind: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new SquadWorkspaceError("invalid-id", `Invalid ${kind} id "${id}"`);
  return id;
}

export interface WorktreeRef {
  path: string;
  branch: string;
}

export function squadBranch(squadId: string, name: string): string {
  return `gravita/${safe("squad", squadId)}/${safe("role", name)}`;
}

export interface SquadLayout {
  /** `<worktreesRoot>/<projectId>/<squadId>`. */
  dir: string;
  integration: WorktreeRef;
  role(roleId: string): WorktreeRef;
}

export function squadLayout(root: string, projectId: string, squadId: string): SquadLayout {
  const dir = join(root, safe("project", projectId), safe("squad", squadId));
  const at = (name: string): WorktreeRef => ({
    path: join(dir, name),
    branch: squadBranch(squadId, name),
  });
  return { dir, integration: at(INTEGRATION), role: at };
}

/**
 * How a lockfile is regenerated: the lockfile only, never install scripts (they would run
 * code from the dependencies). A manager that isn't installed is skipped.
 */
export interface LockfileCommand {
  argv: string[];
}

export const LOCKFILE_COMMANDS: Readonly<Record<string, LockfileCommand>> = {
  "pnpm-lock.yaml": { argv: ["pnpm", "install", "--lockfile-only", "--ignore-scripts"] },
  "package-lock.json": {
    argv: ["npm", "install", "--package-lock-only", "--ignore-scripts"],
  },
  // Yarn Berry: update-lockfile skips the link step, so nothing is built or run.
  "yarn.lock": { argv: ["yarn", "install", "--mode", "update-lockfile"] },
  "bun.lock": { argv: ["bun", "install", "--lockfile-only", "--ignore-scripts"] },
  "bun.lockb": { argv: ["bun", "install", "--lockfile-only", "--ignore-scripts"] },
};

/** Files whose change can make a lockfile stale. */
export const MANIFEST_FILES: ReadonlySet<string> = new Set(["package.json", "pnpm-workspace.yaml"]);

export const basenameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
export const dirnameOf = (path: string): string => {
  const at = path.lastIndexOf("/");
  return at < 0 ? "." : path.slice(0, at);
};
