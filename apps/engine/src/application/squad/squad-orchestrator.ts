import { outsideOwnership, type SquadState, squadPlan, validatePlan } from "@gravita/core";
import { type DeliverMode, keys, type RpcParams, type SquadPlan } from "@gravita/protocol";
import {
  DirtyWorktreeError,
  InvalidCwdError,
  InvalidSquadPlanError,
  NotARepositoryError,
  SquadNotFoundError,
  SquadPhaseError,
  SquadWorkspaceError,
  TooManySquadsError,
} from "../../domain/errors";
import {
  ACTIVE_PHASES,
  MAX_RUNNING_SQUADS,
  SQUAD_PROVIDER,
  squadModels,
} from "../../domain/squad-policy";
import type { Clock } from "../ports/clock";
import type { GitWorkspace } from "../ports/git-workspace";
import type { IdGenerator } from "../ports/id-generator";
import type { Logger } from "../ports/logger";
import type { SquadReader } from "../ports/squad-reader";
import type { Workspace } from "../ports/workspace";
import type { RuntimeFactoryRegistry } from "../services/runtime-factory-registry";
import type { AnnounceProject } from "../usecases/announce-project";
import type { CleanupSquadWorkspace } from "../usecases/cleanup-squad-workspace";
import type { DeliverSquad } from "../usecases/deliver-squad";
import type { PrepareSquadWorkspace } from "../usecases/prepare-squad-workspace";
import { MIN_SESSION_BUDGET_USD } from "./budget-guard";
import type { RunBriefing } from "./run-briefing";
import type { PlannerRun, RunPlanner } from "./run-planner";
import { clip, type SquadEmitter } from "./squad-emitter";
import type { SquadRun, SquadRuns } from "./squad-run";
import { PAUSE_REASONS, type SquadScheduler } from "./squad-scheduler";

// The squad's front door: one instance runs every squad of the engine. It answers the
// squad RPCs, holds the briefing conversation, starts the planner, approves plans into a
// workspace, and hands the running part to the scheduler. Its memory is rebuilt from the
// projection, so a restart loses only what was in flight, and `recover` makes that safe.

export interface SquadOrchestratorDeps {
  squads: SquadReader;
  emitter: SquadEmitter;
  scheduler: SquadScheduler;
  planner: RunPlanner;
  briefing: RunBriefing;
  git: GitWorkspace;
  prepare: PrepareSquadWorkspace;
  deliver: DeliverSquad;
  cleanup: CleanupSquadWorkspace;
  projects: AnnounceProject;
  workspace: Workspace;
  /** The providers squad sessions run on. */
  providers: RuntimeFactoryRegistry;
  ids: IdGenerator;
  clock: Clock;
  logger: Logger;
  runs: SquadRuns;
  /** Squads with work in flight at once (default MAX_RUNNING_SQUADS). */
  maxRunning?: number;
}

const SETTLED_OR_BUSY = new Set(["running", "review", "done", "skipped"]);

export class SquadOrchestrator {
  constructor(private readonly d: SquadOrchestratorDeps) {}

  // ---- RPCs -------------------------------------------------------------------------

  async create(p: RpcParams<"squad.create">): Promise<{ squadId: string; projectId: string }> {
    this.assertCapacity();
    if (!(await this.d.workspace.isDirectory(p.cwd))) throw new InvalidCwdError(p.cwd);
    // Before anything is spent: the briefing's agent must be there, and the folder fit for
    // a squad.
    await this.d.providers.ready(SQUAD_PROVIDER);
    const baseBranch = await this.checkFolder(p.cwd);
    const project = await this.d.projects.execute(p.cwd, this.d.clock.iso());
    const squadId = this.newSquadId();
    const models = squadModels(p.models);
    this.d.emitter.emit("squad.created", keys.squadCreated(squadId), project.id, {
      squadId,
      cwd: p.cwd,
      brief: p.brief,
      models,
      budgetUsd: p.budgetUsd,
      autonomy: p.autonomy,
      baseBranch,
    });
    const run = this.run(this.need(squadId));
    this.d.emitter.phase(run, "brief");
    await this.startBriefing(run);
    return { squadId, projectId: project.id };
  }

  /** Ends the briefing: the planner turns the conversation into a plan. */
  plan(p: RpcParams<"squad.plan">) {
    const q = this.need(p.squadId);
    if (q.phase !== "brief")
      throw new SquadPhaseError("A plan can be asked for only while the squad is being briefed.");
    this.assertCapacity(q.id);
    const run = this.run(q);
    // At once, so the Board moves on and a second click is refused.
    this.d.emitter.phase(run, "planning");
    this.startPlanner(run);
  }

  async replan(p: RpcParams<"squad.replan">): Promise<void> {
    const q = this.need(p.squadId);
    if (q.phase !== "review" && q.phase !== "failed")
      throw new SquadPhaseError("A new plan can be asked for only while the plan is in review.");
    this.assertCapacity(q.id);
    const run = this.run(q);
    run.replanFeedback = p.feedback;
    this.startPlanner(run, p.feedback);
  }

  async approvePlan(p: RpcParams<"squad.approvePlan">): Promise<void> {
    const q = this.need(p.squadId);
    if (q.phase !== "review")
      throw new SquadPhaseError("A plan can be approved only while it is in review.");
    const plan = p.plan as SquadPlan;
    const issues = validatePlan(plan);
    if (issues.length) throw new InvalidSquadPlanError(issues.map((i) => i.message).join(" "));
    this.assertCapacity(q.id);
    // The workspace first: a repository that got dirty meanwhile stops the approval here.
    await this.d.prepare.execute({
      squadId: q.id,
      projectId: q.projectId,
      cwd: q.cwd,
      plan,
      ...(q.baseBranch ? { baseBranch: q.baseBranch } : {}),
    });
    const run = this.run(q);
    this.d.emitter.planApproved(run, plan, p.answers);
    this.d.emitter.phase(run, "foundation");
    run.track(this.d.scheduler.advance(run));
  }

  pause(p: RpcParams<"squad.pause">) {
    const q = this.need(p.squadId);
    if (!ACTIVE_PHASES.has(q.phase) || q.paused)
      throw new SquadPhaseError("Only a squad that is working can be paused.");
    this.d.scheduler.pause(this.run(q), PAUSE_REASONS.user);
  }

  resume(p: RpcParams<"squad.resume">) {
    const q = this.need(p.squadId);
    if (!q.paused || !ACTIVE_PHASES.has(q.phase))
      throw new SquadPhaseError("The squad isn't paused.");
    this.assertCapacity(q.id);
    const roleBudgets = this.checkRoleBudgets(q, p.roleBudgets ?? {});
    const spent = q.budget.spentUsd;
    if (p.budgetUsd !== undefined && p.budgetUsd <= spent)
      throw new SquadPhaseError(
        `The new budget must be more than the $${spent.toFixed(2)} already spent.`,
      );
    const budgetUsd = p.budgetUsd ?? q.budgetUsd;
    if (budgetUsd - spent < MIN_SESSION_BUDGET_USD)
      throw new SquadPhaseError(
        `The squad's budget ($${q.budgetUsd.toFixed(2)}) is used up; resume with a higher budget to go on.`,
      );
    const run = this.run(q);
    if (budgetUsd !== q.budgetUsd || Object.keys(roleBudgets).length)
      this.d.emitter.budgetChanged(run, { budgetUsd, previousUsd: q.budgetUsd, roleBudgets });
    this.d.emitter.resumed(run);
    if (q.phase === "planning") this.startPlanner(run, run.replanFeedback);
    else run.track(this.d.scheduler.advance(run));
  }

  async stop(p: RpcParams<"squad.stop">): Promise<void> {
    const q = this.need(p.squadId);
    if (q.phase === "done" || q.phase === "stopped")
      throw new SquadPhaseError("The squad has already finished.");
    const run = this.run(q);
    this.d.emitter.phase(run, "stopped", "Stopped by you. The worktrees and branches are kept.");
    // The runs see their sessions closing and record the tasks as interrupted.
    await Promise.allSettled(run.sessions().map((s) => s.close()));
  }

  retryTask(p: RpcParams<"squad.task.retry">) {
    const { q, run, task } = this.task(p.squadId, p.taskId);
    if (task.status !== "blocked" && task.status !== "failed")
      throw new SquadPhaseError("Only a blocked or failed task can be retried.");
    run.retries.delete(p.taskId);
    if (p.model) run.modelOverride.set(p.taskId, p.model);
    this.d.emitter.taskStatus(run, {
      taskId: p.taskId,
      status: "ready",
      attempt: task.attempt + 1,
      role: task.role,
      reason: task.reason ? `Retried by you. Earlier: ${task.reason}` : "Retried by you.",
    });
    if (!q.paused) run.track(this.d.scheduler.advance(run));
  }

  skipTask(p: RpcParams<"squad.task.skip">) {
    const { q, run, task } = this.task(p.squadId, p.taskId);
    if (SETTLED_OR_BUSY.has(task.status) || run.active.has(p.taskId))
      throw new SquadPhaseError("A task that is running or finished can't be skipped.");
    this.d.emitter.taskStatus(run, {
      taskId: p.taskId,
      status: "skipped",
      attempt: task.attempt,
      role: task.role,
      reason: "Skipped by you.",
    });
    const cr = Object.values(q.changeRequests).find(
      (c) => c.taskId === p.taskId && c.state === "open",
    );
    if (cr) this.d.emitter.changeRequestResolved(run, cr.requestId, "declined");
    if (!q.paused) run.track(this.d.scheduler.advance(run));
  }

  reassignTask(p: RpcParams<"squad.task.reassign">) {
    const { q, run, task, plan } = this.task(p.squadId, p.taskId);
    if (SETTLED_OR_BUSY.has(task.status) || run.active.has(p.taskId))
      throw new SquadPhaseError("A task that is running or finished can't be reassigned.");
    const role = plan.roles.find((r) => r.id === p.role && r.kind !== "planner");
    if (!role) throw new InvalidSquadPlanError(`"${p.role}" isn't a role that can take tasks.`);
    const writes = plan.tasks.find((t) => t.id === p.taskId)?.writes ?? [];
    const outside = outsideOwnership(plan, role.id, writes);
    if (outside.length)
      throw new InvalidSquadPlanError(
        `${role.id} doesn't own ${outside.join(", ")}; a task can only go to a role that owns what it writes.`,
      );
    this.d.emitter.taskStatus(run, {
      taskId: p.taskId,
      status: "ready",
      attempt: task.attempt + 1,
      role: role.id,
      reason: `Reassigned to ${role.id} by you.`,
    });
    if (!q.paused) run.track(this.d.scheduler.advance(run));
  }

  async deliver(p: { squadId: string; mode: DeliverMode }): Promise<{ ref: string }> {
    const q = this.need(p.squadId);
    const plan = squadPlan(q);
    if (q.phase !== "deliver" || !plan)
      throw new SquadPhaseError("The squad's work can be delivered once the final checks pass.");
    const run = this.run(q);
    const repo = await this.d.git.topLevel(q.cwd);
    const res = await this.d.deliver.execute({
      squadId: q.id,
      projectId: q.projectId,
      mode: p.mode,
      repo,
      baseBranch: q.baseBranch ?? "main",
      integrationBranch: run.layout.integration.branch,
      title: clip(plan.goal.split("\n")[0] ?? plan.goal, 72),
      body: deliveryBody(q, plan),
    });
    if (!res.delivered)
      throw new SquadPhaseError(
        `Your branch moved and now conflicts with the squad's work in ${res.conflicts.join(", ")}. Deliver it as a branch or a pull request instead.`,
      );
    this.d.emitter.phase(run, "done");
    await this.d.cleanup
      .execute({ squadId: q.id, projectId: q.projectId, repo, plan })
      .catch((err) => this.d.logger.log(`squad ${q.id}: cleanup failed`, err));
    return { ref: res.ref };
  }

  // ---- Engine lifecycle ---------------------------------------------------------------

  /**
   * After a restart nothing of a squad is running any more. Tasks that were running or
   * waiting for their merge go back to ready (a merge that did land counts as done), and
   * every working squad starts paused, so nothing spends money until the user resumes.
   * A squad being briefed is left as it is: its conversation isn't running any more (a
   * message to it is refused as not controllable), and `squad.plan` starts the planner
   * afresh with a summary of what was said.
   */
  recover() {
    for (const q of this.d.squads.squads()) {
      if (!q.created || !ACTIVE_PHASES.has(q.phase)) continue;
      const run = this.run(q);
      for (const [taskId, t] of Object.entries(q.tasks)) {
        if (t.status !== "running" && t.status !== "review") continue;
        const merged = q.merges[`${taskId}:${t.attempt}`]?.state === "succeeded";
        if (t.status === "review" && merged) {
          this.d.emitter.taskStatus(run, {
            taskId,
            status: "done",
            attempt: t.attempt,
            role: t.role,
          });
          continue;
        }
        if (t.status === "running" && t.sessionId) run.resumeFrom.set(taskId, t.sessionId);
        this.d.emitter.taskStatus(run, {
          taskId,
          status: "ready",
          attempt: t.attempt + 1,
          role: t.role,
          reason: "Gravita restarted while this ran; the next run continues it.",
        });
      }
      if (!q.paused) this.d.emitter.paused(run, PAUSE_REASONS.restart);
    }
  }

  /** The engine is stopping: nothing more is started or recorded (sessions are disposed by it). */
  close() {
    this.d.scheduler.closing = true;
  }

  /** Resolves once the squad has nothing in flight (tests). */
  async idle(squadId: string): Promise<void> {
    await this.d.runs.get(squadId)?.idle();
  }

  // ---- Helpers -----------------------------------------------------------------------

  private need(squadId: string): SquadState {
    const q = this.d.squads.squad(squadId);
    if (!q?.created) throw new SquadNotFoundError(squadId);
    return q;
  }

  private run(q: SquadState): SquadRun {
    return this.d.runs.of(q);
  }

  private task(squadId: string, taskId: string) {
    const q = this.need(squadId);
    const plan = squadPlan(q);
    const task = q.tasks[taskId];
    if (!plan || q.planStatus !== "approved" || !task)
      throw new SquadPhaseError(`There is no task "${taskId}" running in this squad.`);
    if (q.phase === "done" || q.phase === "stopped" || q.phase === "deliver")
      throw new SquadPhaseError("The squad has finished its tasks.");
    return { q, plan, task, run: this.run(q) };
  }

  /** New role budgets must name roles that take tasks and be above what each spent. */
  private checkRoleBudgets(q: SquadState, budgets: Record<string, number>) {
    const plan = squadPlan(q);
    for (const [roleId, usd] of Object.entries(budgets)) {
      if (!plan?.roles.some((r) => r.id === roleId && r.kind !== "planner"))
        throw new SquadPhaseError(`"${roleId}" isn't a role of this squad.`);
      const spent = q.roles[roleId]?.spentUsd ?? 0;
      if (usd <= spent)
        throw new SquadPhaseError(
          `${roleId}'s new budget must be more than the $${spent.toFixed(2)} it already spent.`,
        );
    }
    return budgets;
  }

  private assertCapacity(except?: string) {
    const limit = this.d.maxRunning ?? MAX_RUNNING_SQUADS;
    const running = this.d.squads
      .squads()
      .filter((q) => q.id !== except && ACTIVE_PHASES.has(q.phase) && !q.paused).length;
    if (running >= limit) throw new TooManySquadsError(limit);
  }

  /** The base branch for a squad in `cwd`; throws when the folder can't take a squad. */
  private async checkFolder(cwd: string): Promise<string> {
    const { git } = this.d;
    if (!(await git.isRepo(cwd))) {
      if (!(await git.isEmptyDir(cwd))) throw new NotARepositoryError(cwd);
      // Gravita turns it into a repository on "main" when the plan is approved.
      return "main";
    }
    const repo = await git.topLevel(cwd);
    if (!(await git.isClean(repo))) throw new DirtyWorktreeError(repo);
    const branch = await git.currentBranch(repo);
    if (!branch)
      throw new SquadWorkspaceError(
        "detached-head",
        "The repository is on a detached HEAD; check out the branch the squad should build on",
      );
    if (!(await git.headSha(repo)))
      throw new SquadWorkspaceError(
        "no-commits",
        "The repository has no commit yet; commit once first",
      );
    return branch;
  }

  private newSquadId(): string {
    for (;;) {
      const id = this.d.ids.uuid().replace(/-/g, "").slice(0, 8);
      if (!this.d.squads.squad(id)) return id;
    }
  }

  /** Where the planner role works: the repository's top level, or the (empty) folder. */
  private async plannerCwd(q: SquadState): Promise<string> {
    return (await this.d.git.isRepo(q.cwd)) ? this.d.git.topLevel(q.cwd) : q.cwd;
  }

  /** A briefing that can't start fails the squad (the user can still ask for a plan with replan). */
  private async startBriefing(run: SquadRun) {
    try {
      await this.d.briefing.start(run, await this.plannerCwd(this.need(run.squadId)));
    } catch (err) {
      if (this.d.scheduler.closing) return;
      this.d.logger.log(`squad ${run.squadId}: the briefing failed`, err);
      const message = err instanceof Error ? err.message : String(err);
      this.d.emitter.phase(run, "failed", `The briefing couldn't start: ${message}`);
    }
  }

  /**
   * Resumes the planner role's session when this engine still knows it (the briefing, or
   * the previous planning run); otherwise, or when Claude Code can't resume it, a fresh
   * session gets the brief and a summary of the briefing.
   */
  private async runPlanner(run: SquadRun, cwd: string, feedback?: string) {
    const base: PlannerRun = feedback ? { feedback } : {};
    const fresh = async () => {
      run.plannerSessionId = undefined;
      const briefing = await this.d.briefing.conversation(this.need(run.squadId));
      return this.d.planner.execute(run, cwd, { ...base, briefing });
    };
    const resumeSessionId = run.plannerSessionId;
    if (!resumeSessionId) return fresh();
    const end = await this.d.planner.execute(run, cwd, { ...base, resumeSessionId });
    if (end.kind !== "unresumable") return end;
    this.d.logger.log(`squad ${run.squadId}: the planner couldn't resume ${resumeSessionId}`);
    return fresh();
  }

  private startPlanner(run: SquadRun, feedback?: string) {
    run.track(
      (async () => {
        try {
          await this.d.briefing.end(run);
          const q = this.need(run.squadId);
          const end = await this.runPlanner(run, await this.plannerCwd(q), feedback);
          if (end.kind === "killed" && !this.d.scheduler.closing)
            this.d.scheduler.pause(run, PAUSE_REASONS.killSwitch);
        } catch (err) {
          if (this.d.scheduler.closing) return;
          this.d.logger.log(`squad ${run.squadId}: the planner failed`, err);
          const message = err instanceof Error ? err.message : String(err);
          this.d.emitter.phase(run, "failed", `The planner couldn't run: ${message}`);
        }
      })(),
    );
  }
}

function deliveryBody(q: SquadState, plan: SquadPlan): string {
  const done = plan.tasks.filter((t) => q.tasks[t.id]?.status === "done");
  return [
    plan.summary,
    "",
    "What was built:",
    ...done.map((t) => `- ${t.title}: ${t.plainSummary}`),
    "",
    "Built by a Gravita squad.",
  ].join("\n");
}
