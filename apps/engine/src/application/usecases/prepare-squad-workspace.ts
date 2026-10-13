import type { SquadPlan } from "@gravita/protocol";
import {
  DirtyWorktreeError,
  InvalidSquadPlanError,
  NotARepositoryError,
  SquadWorkspaceError,
} from "../../domain/errors";
import { INTEGRATION, squadLayout, type WorktreeRef } from "../../domain/squad-workspace";
import type { GitWorkspace } from "../ports/git-workspace";

export interface PrepareSquadWorkspaceParams {
  squadId: string;
  projectId: string;
  /** The folder the user picked: an empty folder or (a folder in) a git repository. */
  cwd: string;
  plan: SquadPlan;
  /** Defaults to the branch checked out in the repository. */
  baseBranch?: string;
}

export interface SquadWorkspace {
  /** The repository's top level (the user's folder, or the repo that contains it). */
  repo: string;
  baseBranch: string;
  /** The commit the integration branch started from. */
  baseSha: string;
  /** True when Gravita turned an empty folder into a repository. */
  initialized: boolean;
  integration: WorktreeRef;
  /** One per role except the planner. */
  roles: Record<string, WorktreeRef>;
}

/**
 * Sets up a squad's git workspace: an empty folder becomes a repository; an existing one
 * must be clean (nothing of the user's is ever stashed or committed). The integration
 * worktree starts at the base branch's head and each writing role's worktree starts at
 * integration. Running it again for the same squad reuses what exists.
 */
export class PrepareSquadWorkspace {
  constructor(
    private readonly d: {
      git: GitWorkspace;
      /** `<dataDir>/worktrees`. */
      worktreesRoot: string;
    },
  ) {}

  async execute(p: PrepareSquadWorkspaceParams): Promise<SquadWorkspace> {
    const { git } = this.d;
    const writers = p.plan.roles.filter((r) => r.kind !== "planner");
    if (writers.some((r) => r.id === INTEGRATION))
      throw new InvalidSquadPlanError(`"${INTEGRATION}" is reserved and can't be a role id`);
    const layout = squadLayout(this.d.worktreesRoot, p.projectId, p.squadId);

    let initialized = false;
    if (!(await git.isRepo(p.cwd))) {
      if (!(await git.isEmptyDir(p.cwd))) throw new NotARepositoryError(p.cwd);
      await git.init(p.cwd);
      initialized = true;
    }
    const repo = await git.topLevel(p.cwd);
    if (!(await git.isClean(repo))) throw new DirtyWorktreeError(repo);

    const baseBranch = p.baseBranch ?? (await git.currentBranch(repo));
    if (!baseBranch)
      throw new SquadWorkspaceError(
        "detached-head",
        "The repository is on a detached HEAD; check out the branch the squad should build on",
      );
    const baseSha = await git.headSha(repo, `refs/heads/${baseBranch}`);
    if (!baseSha) {
      const anyCommit = await git.headSha(repo);
      throw anyCommit
        ? new SquadWorkspaceError("unknown-branch", `There is no branch "${baseBranch}"`)
        : new SquadWorkspaceError(
            "no-commits",
            "The repository has no commit yet; commit once first",
          );
    }

    await git.createWorktree(repo, { ...layout.integration, from: baseSha });
    const roles: Record<string, WorktreeRef> = {};
    for (const role of writers) {
      const ref = layout.role(role.id);
      await git.createWorktree(repo, { ...ref, from: layout.integration.branch });
      roles[role.id] = ref;
    }
    return { repo, baseBranch, baseSha, initialized, integration: layout.integration, roles };
  }
}
