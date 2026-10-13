import {
  budgetState,
  isCounting,
  meterKey,
  meterPoints,
  roleBudget,
  type SquadState,
  squadPlan,
  type UsageLimitState,
  usageKey,
} from "@gravita/core";
import type { AgentProvider, BudgetScope, BudgetUnit, PlanWindow } from "@gravita/protocol";
import {
  BUDGET_WARN_RATIO,
  briefingBudget,
  PLAN_BASELINE_MAX_AGE_MS,
  planBriefingCap,
  plannerBudget,
  planPlannerCap,
  planTaskCap,
  SQUAD_PROVIDER,
  taskBudget,
} from "../../domain/squad-policy";
import type { Clock } from "../ports/clock";
import type { ProjectionReader } from "../ports/projection-reader";
import type { SquadReader } from "../ports/squad-reader";
import type { UsageReader } from "../ports/usage-reader";
import type { SquadEmitter } from "./squad-emitter";
import type { SquadRun } from "./squad-run";

// Budgets in layers. A USD squad: each task's session runs with a maxBudgetUsd (Claude Code
// stops it itself), and after every turn the spend of each role and of the squad is compared
// with their limits. 75% warns once; 100% of a role or of the squad stops everything under
// it. Sessions running side by side share what is left of the squad, so together they can
// only overrun it by what each spends past its own cap (Claude Code checks after each
// response).
//
// A plan squad: its budget is a share of a plan window (core's planShareUsed), checked after
// every turn and every plan usage reading. 75% of the share warns once, 100% pauses the
// squad. Until its baseline is known nothing is paused (the squad is "measuring"). Its
// sessions keep only a generous dollar cap as a safety net (see squad-policy).

export interface Exhaustion {
  scope: Exclude<BudgetScope, "task">;
  /** The role id, or the squad id. */
  scopeId: string;
  unit: BudgetUnit;
  /** Dollars, or points of `window`. */
  used: number;
  limit: number;
  window?: PlanWindow;
}

/** Below this a session isn't worth starting (Claude Code would stop it at once). */
export const MIN_SESSION_BUDGET_USD = 0.05;

export interface BudgetGuardDeps {
  emitter: SquadEmitter;
  /** The live projection: sessions' costs, squads, plan usage. */
  sessions: ProjectionReader & SquadReader & UsageReader;
  clock: Clock;
}

export class BudgetGuard {
  constructor(private readonly d: BudgetGuardDeps) {}

  /** Warns once per scope at 75%, and returns the scopes that ran out. */
  check(q: SquadState, run: SquadRun): Exhaustion[] {
    if (q.budgetPlan) return this.checkPlan(q);
    const ref = { squadId: q.id, projectId: q.projectId };
    const out: Exhaustion[] = [];
    const level = (
      scope: BudgetScope,
      scopeId: string,
      usedUsd: number,
      limitUsd: number,
      keyId?: string,
    ) => {
      if (limitUsd <= 0) return;
      const key = keyId ?? this.levelKey(q, scopeId);
      const b = { scope, scopeId, usedUsd, limitUsd, ...(key ? { keyId: key } : {}) };
      if (usedUsd >= limitUsd && scope !== "task") {
        this.d.emitter.budget(ref, "exhausted", b);
        out.push({ scope, scopeId, unit: "usd", used: usedUsd, limit: limitUsd });
      } else if (usedUsd >= limitUsd * BUDGET_WARN_RATIO) {
        this.d.emitter.budget(ref, "warned", b);
      }
    };

    level("squad", q.id, q.budget.spentUsd, q.budgetUsd);
    for (const role of squadPlan(q)?.roles ?? []) {
      const limit = roleBudget(q, role.id);
      if (limit) level("role", role.id, q.roles[role.id]?.spentUsd ?? 0, limit);
    }
    // A task's own limit is enforced by Claude Code; here it only warns.
    for (const live of run.active.values()) {
      const sid = live.session?.sessionId;
      if (!sid) continue;
      const used = this.d.sessions.session(sid)?.costUsd ?? 0;
      level("task", live.taskId, used, live.maxBudgetUsd, `${live.taskId}:${live.attempt}`);
    }
    return out;
  }

  /** After a budget change the levels count again, under keys of their own. */
  private levelKey(q: SquadState, scopeId: string): string | undefined {
    const changes = q.budgetChanges ?? 0;
    return changes ? `${scopeId}:r${changes}` : undefined;
  }

  /**
   * A plan squad: records where its count starts (and restarts after a window reset), then
   * warns at 75% of its share and runs out at 100%. Roles and tasks have no plan share of
   * their own. While nothing is measured yet it never pauses.
   */
  private checkPlan(stale: SquadState): Exhaustion[] {
    this.measure(stale);
    const q = this.d.sessions.squad(stale.id) ?? stale;
    const plan = q.budgetPlan;
    if (!plan || !isCounting(q)) return [];
    const b = budgetState(q, this.d.sessions.usage());
    if (b.measuring) return [];
    const ref = { squadId: q.id, projectId: q.projectId };
    const keyId = this.levelKey(q, q.id);
    const level = {
      scope: "squad" as const,
      scopeId: q.id,
      unit: "points" as const,
      used: b.spent,
      limit: b.limit,
      window: plan.window,
      ...(b.provider ? { provider: b.provider } : {}),
      ...(keyId ? { keyId } : {}),
    };
    if (b.spent >= b.limit) {
      this.d.emitter.budget(ref, "exhausted", level);
      return [
        {
          scope: "squad",
          scopeId: q.id,
          unit: "points",
          used: b.spent,
          limit: b.limit,
          window: plan.window,
        },
      ];
    }
    if (b.spent >= b.limit * BUDGET_WARN_RATIO) this.d.emitter.budget(ref, "warned", level);
    return [];
  }

  /**
   * Keeps a working plan squad's count of each provider's window on record: its baseline
   * once a fresh reading is known (the usage when it started building), and each new round
   * the projection's meter moved to (a window reset) so a restart counts from it.
   */
  measure(stale: SquadState): void {
    const q = this.d.sessions.squad(stale.id) ?? stale;
    const plan = q.budgetPlan;
    if (!plan || !isCounting(q)) return;
    const ref = { squadId: q.id, projectId: q.projectId };
    for (const provider of squadProviders(q)) {
      const m = q.budget.meters?.[meterKey(provider, plan.window)];
      if (m) {
        if (m.round > m.savedRound) this.d.emitter.baseline(ref, m);
        continue;
      }
      const reading = this.d.sessions.usage()[usageKey(provider, plan.window)];
      if (!reading || !this.freshForStart(q, reading)) continue;
      this.d.emitter.baseline(ref, {
        provider,
        window: plan.window,
        round: 1,
        baseline: reading.usedPercent,
        carried: 0,
        last: reading.usedPercent,
        ...(reading.resetsAt ? { resetsAt: reading.resetsAt } : {}),
      });
    }
  }

  /**
   * After a resume: the count starts again from the window's usage now (when a fresh
   * reading tells it), so the time the squad stood paused doesn't count against it. What it
   * had used is carried.
   */
  rebase(stale: SquadState): void {
    const q = this.d.sessions.squad(stale.id) ?? stale;
    const plan = q.budgetPlan;
    if (!plan) return;
    const ref = { squadId: q.id, projectId: q.projectId };
    const usage = this.d.sessions.usage();
    for (const m of Object.values(q.budget.meters ?? {})) {
      if (m.window !== plan.window) continue;
      const reading = usage[usageKey(m.provider, m.window)];
      if (!reading || this.d.clock.now() - Date.parse(reading.ts) > PLAN_BASELINE_MAX_AGE_MS)
        continue;
      this.d.emitter.baseline(ref, {
        provider: m.provider,
        window: m.window,
        round: m.round + 1,
        baseline: reading.usedPercent,
        carried: meterPoints(m),
        last: reading.usedPercent,
        ...(reading.resetsAt ? { resetsAt: reading.resetsAt } : {}),
      });
    }
  }

  /** A reading is a baseline if it was taken around when the squad started, or since. */
  private freshForStart(q: SquadState, reading: UsageLimitState): boolean {
    const since = Date.parse(q.approvedTs ?? q.createdTs) - PLAN_BASELINE_MAX_AGE_MS;
    return Date.parse(reading.ts) >= since;
  }

  /**
   * What a task's session may spend. USD: its own slice (the role's budget when set), within
   * what is left of its role, and within its share of what is left of the squad among the
   * `concurrent` sessions that will run side by side (this one included). `model` is the
   * one the run uses, so the slice follows the policy's (or the user's) choice. Plan: only
   * a safety cap, a multiple of the task's estimate (the share is checked as it is used).
   */
  forTask(q: SquadState, taskId: string, roleId: string, concurrent = 1, model?: string): number {
    const plan = squadPlan(q);
    if (!plan) return 0;
    if (q.budgetPlan) return round(planTaskCap(plan, q.models, taskId, model));
    const roleLimit = roleBudget(q, roleId);
    const left = q.budgetUsd - q.budget.spentUsd;
    const limits = [
      roleLimit !== undefined
        ? Math.min(roleLimit, q.budgetUsd)
        : taskBudget(plan, q.models, q.budgetUsd, taskId, model),
      left / Math.max(1, concurrent),
    ];
    if (roleLimit !== undefined) limits.push(roleLimit - (q.roles[roleId]?.spentUsd ?? 0));
    return round(Math.max(0, Math.min(...limits)));
  }

  /**
   * The planner's slice, within what is left of the squad (a plan squad: its safety cap).
   * A planner that resumes a session (the briefing, an earlier plan) gets what that session
   * already spent on top: Claude Code compares maxBudgetUsd with the session's cost, which a
   * resumed session carries over.
   */
  forPlanner(q: SquadState, resumeSessionId?: string): number {
    const carried = resumeSessionId ? (this.d.sessions.session(resumeSessionId)?.costUsd ?? 0) : 0;
    if (q.budgetPlan) return round(planPlannerCap(q.models) + carried);
    return round(
      Math.max(0, Math.min(plannerBudget(q.budgetUsd), q.budgetUsd - q.budget.spentUsd)) + carried,
    );
  }

  /** The briefing conversation's slice, within what is left of the squad (plan: a safety cap). */
  forBriefing(q: SquadState): number {
    if (q.budgetPlan) return round(planBriefingCap(q.models));
    return round(
      Math.max(0, Math.min(briefingBudget(q.budgetUsd), q.budgetUsd - q.budget.spentUsd)),
    );
  }

  /** The latest plan usage readings. */
  usage(): Record<string, UsageLimitState> {
    return this.d.sessions.usage();
  }

  /** Whether a plan squad has used its whole share (so nothing new should start). */
  planShareSpent(q: SquadState): boolean {
    if (!q.budgetPlan) return false;
    const b = budgetState(q, this.d.sessions.usage());
    return !b.measuring && b.spent >= b.limit;
  }
}

/** The providers a squad's sessions run on (each one's window is counted). */
function squadProviders(_q: SquadState): AgentProvider[] {
  // Every squad session runs on Claude Code until roles can pick their provider.
  return [SQUAD_PROVIDER];
}

/** Down to the cent (with a hair of slack for float noise: 7.5 stays 7.5). */
const round = (usd: number) => Math.floor(usd * 100 + 1e-6) / 100;
