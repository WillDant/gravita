import { keys, type SquadPlan } from "@gravita/protocol";
import { squadLayout } from "../../domain/squad-workspace";
import type { Clock } from "../ports/clock";
import type { GitWorkspace } from "../ports/git-workspace";
import type { IngestEvents } from "../usecases/ingest-events";
import type { RegenerateShared, RegenerateSharedResult } from "../usecases/regenerate-shared";
import type { RunChecks } from "../usecases/run-checks";
import { squadEvent } from "./squad-events";

export interface MergeJob {
  squadId: string;
  projectId: string;
  plan: SquadPlan;
  roleId: string;
  taskId: string;
  attempt: number;
  /** The role's branch with the task's commit. */
  roleBranch: string;
}

export type MergeResult =
  | { status: "merged"; sha: string; regeneration: RegenerateSharedResult }
  | { status: "conflicted"; paths: string[] }
  | { status: "reverted"; toSha: string; checkId: string; output: string };

/**
 * Merges finished tasks into a squad's integration branch, one at a time and in the order
 * they arrive (one FIFO per squad; squads don't wait for each other). Each merge is a merge
 * commit, then shared files are regenerated and the integration checks run; a red check
 * resets integration to where it was before the merge, so integration is always green.
 */
export class MergeQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  constructor(
    private readonly d: {
      git: GitWorkspace;
      runChecks: RunChecks;
      regenerate: RegenerateShared;
      ingest: IngestEvents;
      clock: Clock;
      /** `<dataDir>/worktrees`. */
      worktreesRoot: string;
    },
  ) {}

  /** Resolves when this job is done (after every job queued before it for the squad). */
  enqueue(job: MergeJob): Promise<MergeResult> {
    const before = this.tails.get(job.squadId) ?? Promise.resolve();
    const run = before.then(() => this.merge(job));
    const tail = run.catch(() => {});
    this.tails.set(job.squadId, tail);
    void tail.then(() => {
      if (this.tails.get(job.squadId) === tail) this.tails.delete(job.squadId);
    });
    return run;
  }

  /** True while a squad has a merge running or waiting. */
  busy(squadId: string): boolean {
    return this.tails.has(squadId);
  }

  private at(job: MergeJob, state: string) {
    return {
      key: keys.merge(job.squadId, job.taskId, job.attempt, state),
      ts: this.d.clock.iso(),
      projectId: job.projectId,
    };
  }

  private ref(job: MergeJob) {
    return { squadId: job.squadId, taskId: job.taskId, role: job.roleId, attempt: job.attempt };
  }

  private async merge(job: MergeJob): Promise<MergeResult> {
    const { git } = this.d;
    const integration = squadLayout(this.d.worktreesRoot, job.projectId, job.squadId).integration
      .path;
    const before = await git.headSha(integration);
    if (!before) throw new Error(`No integration worktree for squad ${job.squadId}`);
    // Integration is Gravita's: whatever a crashed run left in it goes before the next merge.
    await git.revertTo(integration, before);
    this.d.ingest.execute([squadEvent("merge.started", this.at(job, "started"), this.ref(job))]);

    const role = job.plan.roles.find((r) => r.id === job.roleId);
    const task = job.plan.tasks.find((t) => t.id === job.taskId);
    const merged = await git.merge(integration, job.roleBranch, {
      message: `Gravita: merge ${job.taskId}${task ? ` (${task.title})` : ""} from ${role?.name ?? job.roleId}`,
    });
    if (!merged.ok) {
      this.d.ingest.execute([
        squadEvent("merge.conflicted", this.at(job, "conflicted"), {
          ...this.ref(job),
          paths: merged.conflicts,
        }),
      ]);
      return { status: "conflicted", paths: merged.conflicts };
    }

    try {
      const regeneration = await this.d.regenerate.execute({
        plan: job.plan,
        worktree: integration,
        changed: await git.changedFiles(integration, before),
      });
      const results = await this.d.runChecks.execute({
        squadId: job.squadId,
        projectId: job.projectId,
        plan: job.plan,
        worktree: integration,
        when: "integration",
        runId: `merge-${job.taskId}-${job.attempt}`,
        failFast: true,
      });
      const red = results.find((r) => !r.ok);
      if (red) {
        await git.revertTo(integration, before);
        this.d.ingest.execute([
          squadEvent("merge.reverted", this.at(job, "reverted"), {
            ...this.ref(job),
            toSha: before,
            checkId: red.checkId,
          }),
        ]);
        return { status: "reverted", toSha: before, checkId: red.checkId, output: red.output };
      }
      const sha = (await git.headSha(integration)) ?? merged.sha;
      this.d.ingest.execute([
        squadEvent("merge.succeeded", this.at(job, "succeeded"), { ...this.ref(job), sha }),
      ]);
      return { status: "merged", sha, regeneration };
    } catch (err) {
      // Never leave integration half-merged: back to where it was, then report the failure.
      await git.revertTo(integration, before).catch(() => {});
      throw err;
    }
  }
}
