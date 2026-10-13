import type { SquadPlan } from "@gravita/protocol";
import { squadLayout } from "../../domain/squad-workspace";
import type { GitWorkspace } from "../ports/git-workspace";

export interface CleanupSquadWorkspaceParams {
  squadId: string;
  projectId: string;
  repo: string;
  plan: SquadPlan;
  /** Also delete the squad's branches (kept by default: they hold the work). */
  deleteBranches?: boolean;
}

/** Removes a squad's worktrees from Gravita's data dir; the branches stay unless asked. */
export class CleanupSquadWorkspace {
  constructor(private readonly d: { git: GitWorkspace; worktreesRoot: string }) {}

  async execute(p: CleanupSquadWorkspaceParams): Promise<void> {
    const layout = squadLayout(this.d.worktreesRoot, p.projectId, p.squadId);
    const refs = [
      ...p.plan.roles.filter((r) => r.kind !== "planner").map((r) => layout.role(r.id)),
      layout.integration,
    ];
    for (const ref of refs) await this.d.git.removeWorktree(p.repo, ref.path);
    if (p.deleteBranches) for (const ref of refs) await this.d.git.deleteBranch(p.repo, ref.branch);
  }
}
