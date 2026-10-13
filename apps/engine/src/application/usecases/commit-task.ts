import { isShared, outsideOwnership } from "@gravita/core";
import { keys, type SquadPlan } from "@gravita/protocol";
import { GRAVITA_EMAIL } from "../../domain/squad-workspace";
import type { Clock } from "../ports/clock";
import type { GitWorkspace } from "../ports/git-workspace";
import { squadEvent } from "../services/squad-events";
import type { IngestEvents } from "./ingest-events";

export interface CommitTaskParams {
  squadId: string;
  projectId: string;
  plan: SquadPlan;
  roleId: string;
  taskId: string;
  attempt: number;
  /** The role's worktree. */
  worktree: string;
  /** What the role's work is measured against: the integration branch. */
  base: string;
}

export type CommitTaskResult =
  | {
      ok: true;
      /** Null when the task changed nothing. */
      sha: string | null;
      /** The role's files in the commit. */
      files: string[];
      /** Shared files the role changed; put back, Gravita regenerates them. */
      restored: string[];
    }
  | { ok: false; violation: string[] };

/**
 * The commit gate. Gravita, not the agent, commits a finished task: shared files (lockfiles,
 * root manifest, CI) are put back, and anything else outside the role's paths stops the
 * commit with `ownership.violation`. The worktree is then left as it is, so the task can go
 * back to the role with the list of paths to undo.
 */
export class CommitTask {
  constructor(private readonly d: { git: GitWorkspace; ingest: IngestEvents; clock: Clock }) {}

  async execute(p: CommitTaskParams): Promise<CommitTaskResult> {
    const { git } = this.d;
    const from = await git.mergeBase(p.worktree, p.base, "HEAD");
    if (!from) throw new Error(`The role's branch doesn't share history with ${p.base}`);
    const changed = await git.changedFiles(p.worktree, p.base);
    const shared = changed.filter((path) => isShared(p.plan, path));
    const own = changed.filter((path) => !isShared(p.plan, path));
    const at = { ts: this.d.clock.iso(), projectId: p.projectId };

    const outside = outsideOwnership(p.plan, p.roleId, own);
    if (outside.length) {
      this.d.ingest.execute([
        squadEvent(
          "ownership.violation",
          { ...at, key: keys.ownershipViolation(p.squadId, p.taskId, p.attempt) },
          {
            squadId: p.squadId,
            role: p.roleId,
            taskId: p.taskId,
            attempt: p.attempt,
            paths: outside,
          },
        ),
      ]);
      return { ok: false, violation: outside };
    }

    if (shared.length) await git.restorePaths(p.worktree, shared, from);
    const task = p.plan.tasks.find((t) => t.id === p.taskId);
    const role = p.plan.roles.find((r) => r.id === p.roleId);
    let sha = await git.commitAll(p.worktree, {
      message: task ? `${p.taskId}: ${task.title}` : p.taskId,
      coAuthor: `${role?.name ?? p.roleId} (Gravita squad) <${GRAVITA_EMAIL}>`,
    });
    // Nothing left to commit, but the agent committed its work itself: that is the result.
    if (!sha && own.length) sha = await git.headSha(p.worktree);
    if (sha)
      this.d.ingest.execute([
        squadEvent(
          "commit.created",
          { ...at, key: keys.commit(p.squadId, sha) },
          { squadId: p.squadId, role: p.roleId, taskId: p.taskId, sha, files: own },
        ),
      ]);
    return { ok: true, sha, files: own, restored: shared };
  }
}
