import {
  isComplete,
  nextTasks,
  normalizePath,
  type SquadState,
  squadPlan,
  squadTaskModel,
  type TaskRun,
} from "@gravita/core";
import type { SquadPlan } from "@gravita/protocol";
import {
  MAX_AUTO_ATTEMPTS,
  MAX_ROLE_SESSIONS_PER_SQUAD,
  MAX_VERIFY_ROUNDS,
  STOP_GRACE_MS,
} from "../../domain/squad-policy";
import type { Logger } from "../ports/logger";
import type { SquadReader } from "../ports/squad-reader";
import type { FreezeContract } from "../usecases/freeze-contract";
import type { RunChecks } from "../usecases/run-checks";
import { tailBytes } from "../usecases/run-checks";
import { type BudgetGuard, MIN_SESSION_BUDGET_USD } from "./budget-guard";
import { groupByOwner, type SquadDesk } from "./squad-desk";
import type { SquadEmitter } from "./squad-emitter";
import type { LiveAttempt, SquadRun } from "./squad-run";
import type { AttemptEnd, TaskRunner } from "./task-runner";

// The scheduling loop of a squad. After every change it starts what may start (core's
// nextTasks, at most three roles at once), turns each attempt's end into the task's next
// status, and moves the squad through its phases: foundation → build → verify → deliver.

export const PAUSE_REASONS = {
  user: "Paused by you.",
  restart: "Gravita restarted; resume when you're ready.",
  killSwitch: "Sessions were stopped with the kill switch; resume when you're ready.",
} as const;

const OUTPUT_TAIL_BYTES = 3 * 1024;
/** Things that look like file paths in check output ("apps/api/src/x.ts:12:3"). */
const PATH_LIKE = /[\w@./-]+\.[A-Za-z0-9]+/g;

export interface SquadSchedulerDeps {
  squads: SquadReader;
  emitter: SquadEmitter;
  runner: TaskRunner;
  budget: BudgetGuard;
  desk: SquadDesk;
  runChecks: RunChecks;
  freezeContract: FreezeContract;
  logger: Logger;
}

export class SquadScheduler {
  /** Set when the engine is shutting down: nothing new starts and nothing more is recorded. */
  closing = false;

  constructor(private readonly d: SquadSchedulerDeps) {}

  private squad(run: SquadRun): { q: SquadState; plan: SquadPlan } | undefined {
    const q = this.d.squads.squad(run.squadId);
    const plan = q ? squadPlan(q) : undefined;
    return q && plan ? { q, plan } : undefined;
  }

  /** Starts every task that may start now. */
  pump(run: SquadRun) {
    if (this.closing) return;
    const s = this.squad(run);
    if (!s || s.q.paused || (s.q.phase !== "foundation" && s.q.phase !== "build")) return;
    const tasks: Record<string, TaskRun> = {};
    for (const [id, t] of Object.entries(s.q.tasks)) tasks[id] = { status: t.status, role: t.role };
    // Reserved runs count as running even before their session (and its event) exists.
    for (const [id, live] of run.active) tasks[id] = { status: "running", role: live.roleId };
    const next = nextTasks(s.plan, tasks, { maxRoles: MAX_ROLE_SESSIONS_PER_SQUAD });
    // Everything that will run side by side shares what is left of the squad budget.
    const concurrent = run.active.size + next.length;
    for (const id of next) {
      if (!this.launch(run, s.q, s.plan, id, concurrent)) return;
    }
  }

  /** Reserves and starts one attempt; false when the squad had to pause instead. */
  private launch(
    run: SquadRun,
    q: SquadState,
    plan: SquadPlan,
    taskId: string,
    concurrent: number,
  ): boolean {
    const task = plan.tasks.find((t) => t.id === taskId);
    if (!task) return true;
    const state = q.tasks[taskId];
    const roleId = state?.role ?? task.role;
    // Decided once per run, from the projection (role, earlier struggles), so a restart
    // picks the same model; the user's pick on a retry wins.
    const model =
      run.modelOverride.get(taskId) ?? squadTaskModel(q, plan, taskId) ?? q.models.roles;
    if (this.d.budget.planShareSpent(q)) {
      this.pause(run, planSpentReason(q));
      return false;
    }
    const maxBudgetUsd = this.d.budget.forTask(q, taskId, roleId, concurrent, model);
    if (maxBudgetUsd < MIN_SESSION_BUDGET_USD) {
      this.pause(run, "The budget is used up; there isn't enough left to start the next task.");
      return false;
    }
    const ref = run.layout.role(roleId);
    const live: LiveAttempt = {
      squadId: run.squadId,
      projectId: run.projectId,
      roleId,
      taskId,
      attempt: state?.attempt ?? 1,
      worktree: ref.path,
      roleBranch: ref.branch,
      integrationBranch: run.layout.integration.branch,
      model,
      maxBudgetUsd,
      bounces: 0,
      progressCount: 0,
    };
    run.active.set(taskId, live);
    run.track(
      (async () => {
        let end: AttemptEnd;
        try {
          end = await this.d.runner.run(run, live);
        } catch (err) {
          end = { kind: "error", message: err instanceof Error ? err.message : String(err) };
        } finally {
          run.active.delete(taskId);
        }
        if (this.closing) return;
        try {
          this.settle(run, live, end);
        } catch (err) {
          this.d.logger.log(`squad ${run.squadId}: settling ${taskId} failed`, err);
        }
        await this.advance(run);
      })(),
    );
    return true;
  }

  /**
   * The task's next status after an attempt ended. An attempt that struggled (a failure, a
   * conflict, a revert, a red check) is recorded as such on that status, so the next run
   * steps up a model tier under the Automatic policy; an interruption, a question for the
   * user or a spent budget is not the model's doing and isn't.
   */
  settle(run: SquadRun, live: LiveAttempt, end: AttemptEnd) {
    const status = (
      s: "done" | "blocked" | "failed" | "ready",
      reason?: string,
      attempt = live.attempt,
      struggled = false,
    ) =>
      this.d.emitter.taskStatus(run, {
        taskId: live.taskId,
        status: s,
        attempt,
        role: live.roleId,
        ...(reason ? { reason } : {}),
        ...(struggled ? { struggledAttempt: live.attempt } : {}),
      });
    const again = (reason: string) => status("ready", reason, live.attempt + 1);
    const struggled = (s: "blocked" | "failed", reason: string) =>
      status(s, reason, live.attempt, true);

    switch (end.kind) {
      case "merged":
      case "nothing": {
        status("done");
        run.retries.delete(live.taskId);
        const cr = Object.values(this.d.squads.squad(run.squadId)?.changeRequests ?? {}).find(
          (c) => c.taskId === live.taskId && c.state === "open",
        );
        if (cr) this.d.emitter.changeRequestResolved(run, cr.requestId, "done");
        return;
      }
      case "conflicted":
        return this.retry(
          run,
          live,
          `Merging into integration conflicted in ${end.paths.join(", ")}; the next run starts from integration.`,
          "blocked",
        );
      case "reverted":
        return this.retry(
          run,
          live,
          `The ${end.checkId} check failed after the merge, so the merge was undone:\n${tailBytes(end.output, OUTPUT_TAIL_BYTES)}`,
          "blocked",
        );
      case "failed":
        // Includes complete_task sent back too often (ownership, red task checks).
        return struggled("failed", end.reason);
      case "yielded":
        return status("blocked", `Needs you: ${end.reason}`);
      case "incomplete":
        return struggled("blocked", "The agent ended its turn twice without finishing the task.");
      case "max-turns":
        return struggled("blocked", "The agent ran out of turns twice.");
      case "budget":
        this.d.emitter.budget(run, "exhausted", {
          scope: "task",
          scopeId: live.taskId,
          keyId: `${live.taskId}:${live.attempt}`,
          usedUsd: end.usedUsd,
          limitUsd: end.limitUsd,
        });
        return status(
          "blocked",
          this.d.squads.squad(run.squadId)?.budgetPlan
            ? `The task reached its safety cap ($${end.usedUsd.toFixed(2)} of $${end.limitUsd.toFixed(2)}, API-equivalent), set well above its estimate so a runaway run stops.`
            : `The task used its budget ($${end.usedUsd.toFixed(2)} of $${end.limitUsd.toFixed(2)}).`,
        );
      case "interrupted":
        if (end.sessionId) run.resumeFrom.set(live.taskId, end.sessionId);
        return again("Interrupted; the next run continues where it left off.");
      case "killed":
        run.resumeFrom.set(live.taskId, end.sessionId);
        again("Stopped with the kill switch; the next run continues where it left off.");
        return this.pause(run, PAUSE_REASONS.killSwitch);
      case "error":
        return this.retry(run, live, end.message, "failed");
    }
  }

  /**
   * Another automatic run while there are any left, else the task waits for the user. Every
   * caller is a struggle (conflict, revert, error), so the attempt is marked as one.
   */
  private retry(run: SquadRun, live: LiveAttempt, reason: string, otherwise: "blocked" | "failed") {
    const used = run.retries.get(live.taskId) ?? 0;
    const base = {
      taskId: live.taskId,
      role: live.roleId,
      reason,
      struggledAttempt: live.attempt,
    };
    if (used + 1 < MAX_AUTO_ATTEMPTS) {
      run.retries.set(live.taskId, used + 1);
      this.d.emitter.taskStatus(run, { ...base, status: "ready", attempt: live.attempt + 1 });
    } else {
      this.d.emitter.taskStatus(run, { ...base, status: otherwise, attempt: live.attempt });
    }
  }

  /** Moves the squad on when a phase's work is done, then starts what may start. */
  async advance(run: SquadRun): Promise<void> {
    if (this.closing || run.busy) return;
    const s = this.squad(run);
    if (!s || s.q.paused) return;
    if (s.q.phase === "foundation" && foundationDone(s.q, s.plan)) {
      run.busy = true;
      try {
        await this.freezeContracts(run, s.plan);
        this.d.emitter.phase(run, "build");
      } finally {
        run.busy = false;
      }
      return this.advance(run);
    }
    if (s.q.phase === "build" && run.active.size === 0 && isComplete(s.plan, s.q.tasks)) {
      this.d.emitter.phase(run, "verify");
      return this.verify(run);
    }
    if (s.q.phase === "verify") return this.verify(run);
    this.pump(run);
  }

  private async freezeContracts(run: SquadRun, plan: SquadPlan) {
    for (const c of plan.contracts) {
      try {
        await this.d.freezeContract.execute({
          squadId: run.squadId,
          projectId: run.projectId,
          path: c.path,
          version: 1,
        });
      } catch (err) {
        // A contract the foundation didn't write isn't frozen; the build goes on.
        this.d.logger.log(`squad ${run.squadId}: contract ${c.path} not frozen`, err);
      }
    }
  }

  /**
   * The final checks on integration. Green: the squad waits for the user to deliver. Red:
   * the owners of the files named in the output get bug tasks and the squad builds again;
   * when nobody can be named (or after too many rounds) the squad waits for the user.
   */
  async verify(run: SquadRun): Promise<void> {
    if (run.busy) return;
    run.busy = true;
    let rebuild = false;
    try {
      const s = this.squad(run);
      if (!s) return;
      const results = await this.d.runChecks.execute({
        squadId: run.squadId,
        projectId: run.projectId,
        plan: s.plan,
        worktree: run.layout.integration.path,
        when: "final",
        runId: `final-${s.q.phaseRounds.verify ?? 1}`,
      });
      if (this.closing) return;
      const red = results.filter((r) => !r.ok);
      if (!red.length) {
        this.d.emitter.phase(run, "deliver");
        return;
      }
      const report = red
        .map((r) => `${r.checkId} failed:\n${tailBytes(r.output, OUTPUT_TAIL_BYTES)}`)
        .join("\n\n");
      if (run.verifyRounds >= MAX_VERIFY_ROUNDS)
        return this.pause(
          run,
          `The final checks are still red after ${run.verifyRounds} rounds of fixes:\n${report}`,
        );
      const { byOwner } = groupByOwner(s.plan, pathsIn(report, run.layout.integration.path));
      if (!byOwner.size)
        return this.pause(
          run,
          `The final checks failed and Gravita can't tell whose files are involved:\n${report}`,
        );
      run.verifyRounds++;
      this.d.desk.addBugTasks(run, s.plan, byOwner, report);
      this.d.emitter.phase(
        run,
        "build",
        "The final checks found bugs; their owners are fixing them.",
      );
      rebuild = true;
    } finally {
      run.busy = false;
    }
    if (rebuild) this.pump(run);
  }

  /**
   * Stops starting work and interrupts the running sessions (all, or one role's); they get
   * STOP_GRACE_MS to end their turn before they are disposed. The squad waits for the user.
   */
  pause(run: SquadRun, reason: string, onlyRole?: string) {
    const q = this.d.squads.squad(run.squadId);
    if (q && !q.paused) this.d.emitter.paused(run, reason);
    for (const live of run.active.values())
      if (!onlyRole || live.roleId === onlyRole) {
        // A run whose session is still starting sees the flag once it has one.
        live.stopRequested = true;
        live.session?.stop(STOP_GRACE_MS);
      }
    if (!onlyRole) {
      run.plannerStopRequested = true;
      run.planner?.stop(STOP_GRACE_MS);
    }
  }

  /**
   * After every turn, and after every plan usage reading: budgets. A role or the squad out
   * of budget stops and pauses.
   */
  onTurn(run: SquadRun) {
    if (this.closing) return;
    const q = this.d.squads.squad(run.squadId);
    if (!q) return;
    for (const x of this.d.budget.check(q, run)) {
      if (x.unit === "points") return this.pause(run, planSpentReason(q));
      const usd = `$${x.limit.toFixed(2)}`;
      if (x.scope === "squad") return this.pause(run, `The squad's budget (${usd}) is used up.`);
      this.pause(run, `The ${x.scopeId} role's budget (${usd}) is used up.`, x.scopeId);
    }
  }
}

/** Why a plan squad paused: it used its share of the window. */
export function planSpentReason(q: SquadState): string {
  const plan = q.budgetPlan;
  const window = plan?.window === "five_hour" ? "5-hour window" : "weekly limit";
  return `The squad used its share of your ${window} (${plan?.maxPercent ?? 0}%).`;
}

function foundationDone(q: SquadState, plan: SquadPlan): boolean {
  return plan.tasks
    .filter((t) => t.foundation)
    .every((t) => ["done", "skipped"].includes(q.tasks[t.id]?.status ?? "pending"));
}

/** Repo-relative paths named in check output (absolute ones inside `root` included). */
export function pathsIn(output: string, root: string): string[] {
  const out: string[] = [];
  for (const m of output.matchAll(PATH_LIKE)) {
    let p = m[0];
    if (p.startsWith(`${root}/`)) p = p.slice(root.length + 1);
    if (p.startsWith("/")) continue;
    const path = normalizePath(p);
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}
