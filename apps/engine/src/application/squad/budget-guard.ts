import { roleBudget, type SquadState, squadPlan } from "@gravita/core";
import type { BudgetScope } from "@gravita/protocol";
import {
  BUDGET_WARN_RATIO,
  briefingBudget,
  plannerBudget,
  taskBudget,
} from "../../domain/squad-policy";
import type { ProjectionReader } from "../ports/projection-reader";
import type { SquadEmitter } from "./squad-emitter";
import type { SquadRun } from "./squad-run";

// Budgets in layers: each task's session runs with a maxBudgetUsd (Claude Code stops it
// itself), and after every turn the spend of each role and of the squad is compared with
// their limits. 75% warns once; 100% of a role or of the squad stops everything under it.
// Sessions running side by side share what is left of the squad, so together they can only
// overrun it by what each spends past its own cap (Claude Code checks after each response).

export interface Exhaustion {
  scope: Exclude<BudgetScope, "task">;
  /** The role id, or the squad id. */
  scopeId: string;
  usedUsd: number;
  limitUsd: number;
}

/** Below this a session isn't worth starting (Claude Code would stop it at once). */
export const MIN_SESSION_BUDGET_USD = 0.05;

export class BudgetGuard {
  constructor(private readonly d: { emitter: SquadEmitter; sessions: ProjectionReader }) {}

  /** Warns once per scope at 75%, and returns the scopes that ran out. */
  check(q: SquadState, run: SquadRun): Exhaustion[] {
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
      // After a budget change the levels count again, under keys of their own.
      const changes = q.budgetChanges ?? 0;
      const key = keyId ?? (changes ? `${scopeId}:r${changes}` : undefined);
      const b = { scope, scopeId, usedUsd, limitUsd, ...(key ? { keyId: key } : {}) };
      if (usedUsd >= limitUsd && scope !== "task") {
        this.d.emitter.budget(ref, "exhausted", b);
        out.push({ scope, scopeId, usedUsd, limitUsd });
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

  /**
   * What a task's session may spend: its own slice (the role's budget when set), within what
   * is left of its role, and within its share of what is left of the squad among the
   * `concurrent` sessions that will run side by side (this one included). `model` is the
   * one the run uses, so the slice follows the policy's (or the user's) choice.
   */
  forTask(q: SquadState, taskId: string, roleId: string, concurrent = 1, model?: string): number {
    const plan = squadPlan(q);
    if (!plan) return 0;
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
   * The planner's slice, within what is left of the squad. A planner that resumes a session
   * (the briefing, an earlier plan) gets what that session already spent on top: Claude Code
   * compares maxBudgetUsd with the session's cost, which a resumed session carries over.
   */
  forPlanner(q: SquadState, resumeSessionId?: string): number {
    const carried = resumeSessionId ? (this.d.sessions.session(resumeSessionId)?.costUsd ?? 0) : 0;
    return round(
      Math.max(0, Math.min(plannerBudget(q.budgetUsd), q.budgetUsd - q.budget.spentUsd)) + carried,
    );
  }

  /** The briefing conversation's slice, within what is left of the squad. */
  forBriefing(q: SquadState): number {
    return round(
      Math.max(0, Math.min(briefingBudget(q.budgetUsd), q.budgetUsd - q.budget.spentUsd)),
    );
  }
}

/** Down to the cent (with a hair of slack for float noise: 7.5 stays 7.5). */
const round = (usd: number) => Math.floor(usd * 100 + 1e-6) / 100;
