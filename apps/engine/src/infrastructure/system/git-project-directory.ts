import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { ProjectIdentity } from "@gravita/protocol";
import type { ProjectDirectory } from "../../application/ports/project-directory";

// A project is a git repository, grouped by its common dir so that every worktree
// (Gravita's, Conductor's, Claude's) lands in the same project.

/** Returns the absolute git common dir for `cwd`, or null when it isn't a (live) repo. */
export type GitCommonDir = (cwd: string) => Promise<string | null>;

const sha16 = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

export const gitCommonDir: GitCommonDir = async (cwd) => {
  try {
    const env = { ...process.env };
    for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete env[k];
    const proc = Bun.spawn(
      ["git", "-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
        env: { ...env, GIT_OPTIONAL_LOCKS: "0" },
        timeout: 5_000,
      },
    );
    const out = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    return out.trim() || null;
  } catch {
    return null;
  }
};

export async function resolveProject(
  cwd: string,
  git: GitCommonDir = gitCommonDir,
): Promise<ProjectIdentity> {
  const common = await git(cwd);
  if (common) {
    const real = await realpath(common).catch(() => common);
    const root = basename(real) === ".git" ? dirname(real) : real;
    return { id: sha16(real), root, name: basename(root) };
  }
  // Not a repo, or a deleted worktree: the cwd itself is the project.
  return { id: sha16(cwd), root: cwd, name: basename(cwd) || cwd };
}

/** Resolves cwds to projects through git, caching each cwd. */
export class GitProjectDirectory implements ProjectDirectory {
  private readonly cache = new Map<string, Promise<ProjectIdentity>>();

  constructor(private readonly git: GitCommonDir = gitCommonDir) {}

  resolve(cwd: string): Promise<ProjectIdentity> {
    let p = this.cache.get(cwd);
    if (!p) {
      p = resolveProject(cwd, this.git);
      this.cache.set(cwd, p);
    }
    return p;
  }
}
