import type { PlanMeter } from "@gravita/core";
import {
  type AgentProvider,
  type BudgetScope,
  type EventOf,
  keys,
  type PlanTask,
  type PlanWindow,
  type SquadPhase,
  type SquadPlan,
  type TaskStatus,
} from "@gravita/protocol";
import type { Clock } from "../ports/clock";
import type { SquadReader } from "../ports/squad-reader";
import { type SquadEventType, squadEvent } from "../services/squad-events";
import type { IngestEvents } from "../usecases/ingest-events";

// Every squad fact the orchestrator states goes through here, with its deterministic key:
// counters (phase rounds, pauses) come from the projection, so a replay after a crash
// derives the same keys and nothing is stored twice.

/** Reasons carry check output and the like: enough to act on, never a whole log. */
export const MAX_REASON_CHARS = 2_000;

export const clip = (text: string, max = MAX_REASON_CHARS): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export interface SquadRef {
  squadId: string;
  projectId: string;
}

export interface TaskStatusFact {
  taskId: string;
  status: TaskStatus;
  attempt: number;
  role: string;
  sessionId?: string;
  reason?: string;
  /** The attempt that went wrong in a way a stronger model may fix (see the event). */
  struggledAttempt?: number;
}

/** A budget level: dollars (USD squads, roles, tasks), or points of a plan window. */
export type BudgetLevelFact =
  | { scope: BudgetScope; scopeId: string; keyId?: string; usedUsd: number; limitUsd: number }
  | {
      scope: BudgetScope;
      scopeId: string;
      keyId?: string;
      unit: "points";
      used: number;
      limit: number;
      window: PlanWindow;
      provider?: AgentProvider;
    };

export class SquadEmitter {
  constructor(private readonly d: { ingest: IngestEvents; clock: Clock; squads: SquadReader }) {}

  emit<T extends SquadEventType>(
    type: T,
    key: string,
    projectId: string,
    data: EventOf<T>["data"],
  ): boolean {
    return (
      this.d.ingest.execute([squadEvent(type, { key, ts: this.d.clock.iso(), projectId }, data)])
        .length > 0
    );
  }

  phase(q: SquadRef, phase: SquadPhase, reason?: string) {
    const round = (this.d.squads.squad(q.squadId)?.phaseRounds[phase] ?? 0) + 1;
    this.emit("squad.phase_changed", keys.squadPhase(q.squadId, phase, round), q.projectId, {
      squadId: q.squadId,
      phase,
      ...(reason ? { reason: clip(reason) } : {}),
    });
  }

  planProposed(q: SquadRef, attempt: number, plan: SquadPlan) {
    this.emit("plan.proposed", keys.planProposed(q.squadId, attempt), q.projectId, {
      squadId: q.squadId,
      attempt,
      plan,
    });
  }

  planRejected(q: SquadRef, attempt: number, errors: string[]) {
    this.emit("plan.rejected", keys.planRejected(q.squadId, attempt), q.projectId, {
      squadId: q.squadId,
      attempt,
      errors: errors.map((e) => clip(e, 500)),
    });
  }

  planApproved(q: SquadRef, plan: SquadPlan, answers?: Record<string, string>) {
    this.emit("plan.approved", keys.planApproved(q.squadId), q.projectId, {
      squadId: q.squadId,
      plan,
      ...(answers && Object.keys(answers).length ? { answers } : {}),
    });
  }

  taskStatus(q: SquadRef, f: TaskStatusFact) {
    this.emit(
      "task.status_changed",
      keys.taskStatus(q.squadId, f.taskId, f.attempt, f.status),
      q.projectId,
      {
        squadId: q.squadId,
        taskId: f.taskId,
        status: f.status,
        attempt: f.attempt,
        role: f.role,
        ...(f.sessionId ? { sessionId: f.sessionId } : {}),
        ...(f.reason ? { reason: clip(f.reason) } : {}),
        ...(f.struggledAttempt ? { struggledAttempt: f.struggledAttempt } : {}),
      },
    );
  }

  taskAdded(q: SquadRef, task: PlanTask, origin: "change_request" | "bug", fromRole?: string) {
    this.emit("task.added", keys.taskAdded(q.squadId, task.id), q.projectId, {
      squadId: q.squadId,
      task,
      origin,
      ...(fromRole ? { fromRole } : {}),
    });
  }

  note(q: SquadRef, noteId: string, fromRole: string, text: string, toRole?: string) {
    this.emit("note.posted", keys.note(q.squadId, noteId), q.projectId, {
      squadId: q.squadId,
      noteId,
      fromRole,
      ...(toRole ? { toRole } : {}),
      text: clip(text),
    });
  }

  changeRequestOpened(
    q: SquadRef,
    r: { requestId: string; fromRole: string; toRole: string; text: string; taskId: string },
  ) {
    this.emit(
      "change_request.opened",
      keys.changeRequest(q.squadId, r.requestId, "opened"),
      q.projectId,
      { squadId: q.squadId, ...r, text: clip(r.text) },
    );
  }

  changeRequestResolved(q: SquadRef, requestId: string, outcome: "done" | "declined") {
    this.emit(
      "change_request.resolved",
      keys.changeRequest(q.squadId, requestId, "resolved"),
      q.projectId,
      { squadId: q.squadId, requestId, outcome },
    );
  }

  /**
   * `keyId` tells apart levels of the same scope that may repeat (a task's attempts) while
   * the event keeps the plain scope id. A USD level states dollars, as before plan budgets;
   * a plan level states points of its window.
   */
  budget(q: SquadRef, level: "warned" | "exhausted", b: BudgetLevelFact): boolean {
    const data =
      "unit" in b
        ? {
            squadId: q.squadId,
            scope: b.scope,
            scopeId: b.scopeId,
            unit: b.unit,
            used: b.used,
            limit: b.limit,
            window: b.window,
            ...(b.provider ? { provider: b.provider } : {}),
          }
        : {
            squadId: q.squadId,
            scope: b.scope,
            scopeId: b.scopeId,
            usedUsd: b.usedUsd,
            limitUsd: b.limitUsd,
          };
    const key = keys.budget(q.squadId, b.scope, b.keyId ?? b.scopeId, level);
    return level === "warned"
      ? this.emit("budget.warned", key, q.projectId, data)
      : this.emit("budget.exhausted", key, q.projectId, data);
  }

  /** Where a plan squad's count of a provider's window starts, for this round. */
  baseline(
    q: SquadRef,
    m: Pick<PlanMeter, "provider" | "window" | "round" | "baseline" | "carried" | "last"> & {
      resetsAt?: string;
    },
  ) {
    this.emit(
      "budget.baseline",
      keys.budgetBaseline(q.squadId, m.provider, m.window, m.round),
      q.projectId,
      {
        squadId: q.squadId,
        provider: m.provider,
        window: m.window,
        round: m.round,
        baseline: m.baseline,
        carried: Math.round(m.carried * 100) / 100,
        current: m.last,
        ...(m.resetsAt ? { resetsAt: m.resetsAt } : {}),
      },
    );
  }

  /** The highest usage a plan squad's count of a provider's window reached in its round. */
  measured(q: SquadRef, m: Pick<PlanMeter, "provider" | "window" | "round" | "last">) {
    const last = Math.round(m.last * 100) / 100;
    this.emit(
      "budget.measured",
      keys.budgetMeasured(q.squadId, m.provider, m.window, m.round, last),
      q.projectId,
      { squadId: q.squadId, provider: m.provider, window: m.window, round: m.round, last },
    );
  }

  budgetChanged(
    q: SquadRef,
    c:
      | { budgetUsd: number; previousUsd: number; roleBudgets?: Record<string, number> }
      | { maxPercent: number; previousPercent: number },
  ) {
    const n = (this.d.squads.squad(q.squadId)?.budgetChanges ?? 0) + 1;
    this.emit("squad.budget_changed", keys.budgetChanged(q.squadId, n), q.projectId, {
      squadId: q.squadId,
      ...("maxPercent" in c
        ? { maxPercent: c.maxPercent, previousPercent: c.previousPercent }
        : {
            budgetUsd: c.budgetUsd,
            previousUsd: c.previousUsd,
            ...(c.roleBudgets && Object.keys(c.roleBudgets).length
              ? { roleBudgets: c.roleBudgets }
              : {}),
          }),
    });
  }

  paused(q: SquadRef, reason: string) {
    const n = (this.d.squads.squad(q.squadId)?.pauseCount ?? 0) + 1;
    this.emit("squad.paused", keys.squadPaused(q.squadId, n), q.projectId, {
      squadId: q.squadId,
      reason: clip(reason),
    });
  }

  resumed(q: SquadRef) {
    const n = (this.d.squads.squad(q.squadId)?.resumeCount ?? 0) + 1;
    this.emit("squad.resumed", keys.squadResumed(q.squadId, n), q.projectId, {
      squadId: q.squadId,
    });
  }
}
