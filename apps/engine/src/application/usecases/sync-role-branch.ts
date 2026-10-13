import type { GitWorkspace, MergeOutcome } from "../ports/git-workspace";

export interface SyncRoleBranchParams {
  roleWorktree: string;
  integrationBranch: string;
}

export const SYNC_MESSAGE = "Gravita: sync with integration";

/**
 * Before a role's next task, brings integration (the other roles' merged work) into the
 * role's branch: a fast-forward when the role has nothing new, a merge commit otherwise.
 * A conflict is aborted and returned, for the orchestrator to hand to the role as a task.
 */
export class SyncRoleBranch {
  constructor(private readonly d: { git: GitWorkspace }) {}

  execute(p: SyncRoleBranchParams): Promise<MergeOutcome> {
    return this.d.git.merge(p.roleWorktree, p.integrationBranch, {
      message: SYNC_MESSAGE,
      fastForward: true,
    });
  }
}
