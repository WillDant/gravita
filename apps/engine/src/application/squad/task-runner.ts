import { type SquadState, squadPlan } from "@gravita/core";
import type { PlanTask } from "@gravita/protocol";
import { rolePermission, rolePermissionMode } from "../../domain/autonomy-policy";
import { guardToolCall } from "../../domain/ownership-guard";
import { ROLE_ENV, ROLE_MAX_TURNS, STOP_GRACE_MS, squadEnv } from "../../domain/squad-policy";
import type { GitWorkspace } from "../ports/git-workspace";
import type { SquadReader } from "../ports/squad-reader";
import type { SyncRoleBranch } from "../usecases/sync-role-branch";
import { CONTINUE_PROMPT, NUDGE_PROMPT, roleCharter, taskPrompt } from "./prompts";
import { type RoleToolHost, roleTools } from "./role-tools";
import type { SquadEmitter } from "./squad-emitter";
import type { LiveAttempt, SquadRun } from "./squad-run";
import type { SquadSession, SquadSessions } from "./squad-sessions";

// One run (attempt) of a task: bring the role's branch up to date, start a session in its
// worktree with the task as the first message, follow its turns (one nudge, one extension
// of turns) and, once complete_task committed the work, wait for the merge. It reports how
// the attempt ended; the orchestrator turns that into the task's next status.

export type AttemptEnd =
  | { kind: "merged"; sha: string }
  /** complete_task found nothing to commit. */
  | { kind: "nothing" }
  | { kind: "conflicted"; paths: string[] }
  | { kind: "reverted"; checkId: string; output: string }
  | { kind: "failed"; reason: string }
  | { kind: "yielded"; reason: string }
  /** The turn ended twice without complete_task. */
  | { kind: "incomplete" }
  | { kind: "budget"; usedUsd: number; limitUsd: number }
  | { kind: "max-turns" }
  /** Gravita stopped it (pause, stop, budget): continue it later in the same session. */
  | { kind: "interrupted"; sessionId?: string }
  /** Someone else disposed the session: the kill switch. */
  | { kind: "killed"; sessionId: string }
  | { kind: "error"; message: string };

export interface TaskRunnerDeps {
  sessions: SquadSessions;
  squads: SquadReader;
  git: GitWorkspace;
  syncRoleBranch: SyncRoleBranch;
  emitter: SquadEmitter;
  host: RoleToolHost;
  /** Called after every turn (budget checks). */
  onTurn(run: SquadRun): void;
}

export class TaskRunner {
  constructor(private readonly d: TaskRunnerDeps) {}

  /** Runs the attempt that `live` (already reserved in `run.active`) stands for. */
  async run(run: SquadRun, live: LiveAttempt): Promise<AttemptEnd> {
    const q = this.d.squads.squad(run.squadId);
    const plan = q ? squadPlan(q) : undefined;
    const task = plan?.tasks.find((t) => t.id === live.taskId);
    const role = plan?.roles.find((r) => r.id === live.roleId);
    if (!q || !plan || !task || !role)
      return { kind: "failed", reason: `Task ${live.taskId} or its role is not in the plan.` };

    const resumeFrom = run.resumeFrom.get(live.taskId);
    run.resumeFrom.delete(live.taskId);
    let feedback = q.tasks[live.taskId]?.reason;
    if (!resumeFrom) {
      const reset = await this.prepareBranch(live);
      if (reset) feedback = [feedback, reset].filter(Boolean).join("\n");
    }

    if (live.stopRequested) return { kind: "interrupted" };
    const roots = [
      live.worktree,
      await this.d.git.topLevel(live.worktree).catch(() => live.worktree),
    ];
    const session = await this.d.sessions.start({
      squadId: run.squadId,
      projectId: run.projectId,
      roleId: live.roleId,
      taskId: live.taskId,
      cwd: live.worktree,
      model: live.model,
      permissionMode: rolePermissionMode(q.autonomy),
      prompt: taskPrompt({
        plan,
        task,
        brief: q.brief,
        ...(q.answers ? { answers: q.answers } : {}),
        notes: notesFor(q, live.roleId, task),
        ...(feedback ? { feedback } : {}),
        ...(resumeFrom ? { resumed: true } : {}),
      }),
      ...(resumeFrom ? { resumeSessionId: resumeFrom } : {}),
      systemPromptAppend: roleCharter(plan, role, live.worktree),
      maxBudgetUsd: live.maxBudgetUsd,
      maxTurns: ROLE_MAX_TURNS,
      env: { ...ROLE_ENV, ...squadEnv(q.models) },
      roleTools: roleTools(this.d.host, live),
      toolGuard: (call) => guardToolCall({ plan, roleId: live.roleId, roots }, call),
      permissionPolicy: (tool, input) => rolePermission(q.autonomy, tool, input),
    });
    live.session = session;
    if (live.stopRequested) session.stop(STOP_GRACE_MS);
    this.d.emitter.taskStatus(run, {
      taskId: live.taskId,
      status: "running",
      attempt: live.attempt,
      role: live.roleId,
      sessionId: session.sessionId,
    });
    try {
      return await this.follow(run, live, session);
    } finally {
      await session.dispose();
    }
  }

  /**
   * Drops leftovers of an earlier run and brings integration into the role's branch. When
   * the role's unmerged work conflicts with integration, the branch starts over from
   * integration and the returned text tells the agent why.
   */
  private async prepareBranch(live: LiveAttempt): Promise<string | undefined> {
    const { git } = this.d;
    const head = await git.headSha(live.worktree);
    if (head) await git.revertTo(live.worktree, head);
    const synced = await this.d.syncRoleBranch.execute({
      roleWorktree: live.worktree,
      integrationBranch: live.integrationBranch,
    });
    if (synced.ok) return undefined;
    const integration = await git.headSha(live.worktree, live.integrationBranch);
    if (integration) await git.revertTo(live.worktree, integration);
    return `Your branch's earlier, unmerged work conflicted with integration in ${synced.conflicts.join(", ")}, so Gravita started your branch over from integration. Redo what's needed on top of it.`;
  }

  private async follow(
    run: SquadRun,
    live: LiveAttempt,
    session: SquadSession,
  ): Promise<AttemptEnd> {
    let nudged = false;
    let extended = false;
    for (;;) {
      const o = await session.nextTurn();
      if (o.kind === "result") this.d.onTurn(run);
      if (live.completion) {
        // The work is committed: free the session while the merge runs.
        await session.dispose();
        return this.merged(live);
      }
      if (live.failed) return { kind: "failed", reason: live.failed };
      if (live.yielded) return { kind: "yielded", reason: live.yielded };
      if (session.stopping) return { kind: "interrupted", sessionId: session.sessionId };
      if (o.kind === "ended")
        return o.reason === "disposed" && !session.disposedByGravita
          ? { kind: "killed", sessionId: session.sessionId }
          : {
              kind: "error",
              message:
                o.reason === "crashed"
                  ? "Claude Code stopped unexpectedly."
                  : "The session ended before the task was done.",
            };
      try {
        if (o.subtype === "success" && !nudged) {
          nudged = true;
          await session.send(NUDGE_PROMPT);
          continue;
        }
        // "Resume once with a higher limit": the same session gets a fresh run of turns.
        if (o.subtype === "error_max_turns" && !extended) {
          extended = true;
          await session.send(CONTINUE_PROMPT);
          continue;
        }
      } catch (err) {
        return { kind: "error", message: err instanceof Error ? err.message : String(err) };
      }
      switch (o.subtype) {
        case "success":
          return { kind: "incomplete" };
        case "error_max_turns":
          return { kind: "max-turns" };
        case "error_max_budget_usd":
          return {
            kind: "budget",
            usedUsd: o.totalCostUsd ?? live.maxBudgetUsd,
            limitUsd: live.maxBudgetUsd,
          };
        default:
          return { kind: "error", message: o.errors.join("; ") || o.subtype };
      }
    }
  }

  private async merged(live: LiveAttempt): Promise<AttemptEnd> {
    const merge = live.completion?.merge;
    if (!merge) return { kind: "nothing" };
    try {
      const r = await merge;
      if (r.status === "merged") return { kind: "merged", sha: r.sha };
      if (r.status === "conflicted") return { kind: "conflicted", paths: r.paths };
      return { kind: "reverted", checkId: r.checkId, output: r.output };
    } catch (err) {
      return {
        kind: "error",
        message: `Merging into integration failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

/** Notes for a role (or everyone) from the others, plus the change request behind a task. */
function notesFor(q: SquadState, roleId: string, task: PlanTask) {
  const notes = q.notes
    .filter((n) => n.fromRole !== roleId && (n.toRole === undefined || n.toRole === roleId))
    .slice(-20)
    .map((n) => ({ fromRole: n.fromRole, text: n.text }));
  const cr = Object.values(q.changeRequests).find((c) => c.taskId === task.id);
  if (cr) notes.push({ fromRole: cr.fromRole, text: `Change request: ${cr.text}` });
  return notes;
}
