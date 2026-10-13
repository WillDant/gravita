import type { GravitaEvent, SquadPlan } from "@gravita/protocol";
import type { GravitaState } from "../state";
import type {
  BudgetKey,
  MergeState,
  OwnershipViolationState,
  SquadState,
  SquadTaskState,
} from "./state";

// Squad events carry their squad in the data and no session. Like the session reducer,
// this is mutating, deterministic and order-tolerant: a role session can start before
// squad.created lands, so the squad is created lazily as a stub.

const later = (a: string, b: string) => (b > a ? b : a);

export function ensureSquad(
  state: GravitaState,
  id: string,
  projectId: string,
  ts: string,
): SquadState {
  state.squads ??= {};
  let q = state.squads[id];
  if (!q) {
    q = {
      id,
      projectId,
      created: false,
      cwd: "",
      brief: "",
      models: { planner: "default", roles: "default" },
      budgetUsd: 0,
      autonomy: "guarded",
      phase: "brief",
      phaseRounds: {},
      createdTs: ts,
      lastEventTs: ts,
      planStatus: "none",
      planAttempts: 0,
      planRevision: 0,
      tasks: {},
      roles: {},
      sessionIds: [],
      notes: [],
      changeRequests: {},
      contracts: {},
      commits: [],
      violations: [],
      merges: {},
      checks: {},
      budget: { spentUsd: 0, warned: [], exhausted: [] },
    };
    state.squads[id] = q;
  }
  return q;
}

function ensureRole(q: SquadState, roleId: string) {
  let r = q.roles[roleId];
  if (!r) {
    r = { sessionIds: [], spentUsd: 0 };
    q.roles[roleId] = r;
  }
  return r;
}

/** Links a session to its squad (and role), from session.started's squad fields. */
export function linkSquadSession(
  state: GravitaState,
  squadId: string,
  sessionId: string,
  roleId: string | undefined,
  projectId: string,
  ts: string,
): void {
  const q = ensureSquad(state, squadId, projectId, ts);
  if (!q.sessionIds.includes(sessionId)) q.sessionIds.push(sessionId);
  if (roleId) {
    const r = ensureRole(q, roleId);
    if (!r.sessionIds.includes(sessionId)) r.sessionIds.push(sessionId);
    // The newest session is the role's current one; compare start times, not arrival.
    const cur = r.currentSessionId ? state.sessions[r.currentSessionId] : undefined;
    const startedTs = state.sessions[sessionId]?.startedTs ?? ts;
    if (!cur || cur.startedTs <= startedTs) r.currentSessionId = sessionId;
  }
  recomputeSpend(state, q);
}

/**
 * Role and squad spend from the sessions' cumulative cost. Recomputed from scratch, so a
 * repeated or late cost snapshot never double counts.
 */
export function recomputeSpend(state: GravitaState, q: SquadState): void {
  const cost = (sid: string) => state.sessions[sid]?.costUsd ?? 0;
  for (const r of Object.values(q.roles))
    r.spentUsd = r.sessionIds.reduce((n, s) => n + cost(s), 0);
  q.budget.spentUsd = q.sessionIds.reduce((n, s) => n + cost(s), 0);
}

// A merge only moves forward: started → succeeded | conflicted → reverted.
const MERGE_RANK: Record<MergeState, number> = {
  started: 0,
  succeeded: 1,
  conflicted: 1,
  reverted: 2,
};

function addOnce<T>(list: T[], item: T) {
  if (!list.includes(item)) list.push(item);
}

/** The struggled attempts with `attempt` added once, ascending. */
function withStruggle(list: number[] | undefined, attempt: number | undefined) {
  if (attempt === undefined || list?.includes(attempt)) return list;
  return [...(list ?? []), attempt].sort((a, b) => a - b);
}

/** Applies a squad event. Returns false for any other event type. */
export function applySquad(state: GravitaState, e: GravitaEvent): boolean {
  switch (e.type) {
    case "squad.created":
    case "squad.phase_changed":
    case "plan.proposed":
    case "plan.rejected":
    case "plan.edited":
    case "plan.approved":
    case "task.status_changed":
    case "note.posted":
    case "change_request.opened":
    case "change_request.resolved":
    case "contract.frozen":
    case "commit.created":
    case "ownership.violation":
    case "merge.started":
    case "merge.succeeded":
    case "merge.conflicted":
    case "merge.reverted":
    case "check.ran":
    case "budget.warned":
    case "budget.exhausted":
    case "squad.budget_changed":
    case "squad.paused":
    case "squad.resumed":
    case "task.added":
    case "squad.delivered":
      break;
    default:
      return false;
  }

  const q = ensureSquad(state, e.data.squadId, e.projectId, e.ts);
  q.lastEventTs = later(q.lastEventTs, e.ts);

  switch (e.type) {
    case "squad.created":
      q.created = true;
      q.projectId = e.projectId;
      q.cwd = e.data.cwd;
      q.brief = e.data.brief;
      q.models = e.data.models;
      q.budgetUsd = e.data.budgetUsd;
      q.autonomy = e.data.autonomy;
      if (e.data.baseBranch) q.baseBranch = e.data.baseBranch;
      q.createdTs = e.ts;
      return true;

    case "squad.phase_changed":
      q.phaseRounds[e.data.phase] = (q.phaseRounds[e.data.phase] ?? 0) + 1;
      // A late, older transition must not move the squad back.
      if (!q.phaseTs || e.ts >= q.phaseTs) {
        q.phase = e.data.phase;
        q.phaseTs = e.ts;
        if (e.data.reason) q.phaseReason = e.data.reason;
        else delete q.phaseReason;
      }
      return true;

    case "plan.proposed":
      q.planAttempts = Math.max(q.planAttempts, e.data.attempt);
      // An approved plan is final; a late proposal doesn't replace it.
      if (q.planStatus !== "approved") {
        q.plan = e.data.plan;
        q.planStatus = "proposed";
      }
      if (q.planErrorsAttempt !== undefined && e.data.attempt > q.planErrorsAttempt) {
        delete q.planErrors;
        delete q.planErrorsAttempt;
      }
      return true;

    case "plan.rejected":
      q.planAttempts = Math.max(q.planAttempts, e.data.attempt);
      if (q.planErrorsAttempt === undefined || e.data.attempt >= q.planErrorsAttempt) {
        q.planErrors = e.data.errors;
        q.planErrorsAttempt = e.data.attempt;
      }
      return true;

    case "plan.edited":
      if (e.data.revision >= q.planRevision && q.planStatus !== "approved") {
        q.plan = e.data.plan;
        q.planStatus = "edited";
      }
      q.planRevision = Math.max(q.planRevision, e.data.revision);
      return true;

    case "plan.approved":
      q.plan = e.data.plan;
      q.planStatus = "approved";
      q.approvedTs = e.ts;
      if (e.data.answers && Object.keys(e.data.answers).length) q.answers = e.data.answers;
      for (const r of e.data.plan.roles) ensureRole(q, r.id);
      // Status events may have landed first; never reset a task that already moved.
      for (const t of e.data.plan.tasks)
        q.tasks[t.id] ??= { status: "pending", attempt: 1, role: t.role, updatedTs: e.ts };
      return true;

    case "task.status_changed": {
      const prev = q.tasks[e.data.taskId];
      // A struggle is a fact about an attempt, kept whatever order the statuses come in.
      const struggled = withStruggle(prev?.struggled, e.data.struggledAttempt);
      if (prev && e.data.attempt < prev.attempt) {
        if (struggled) prev.struggled = struggled;
        return true;
      }
      // A newer attempt wins; within one attempt, source order wins.
      const task: SquadTaskState = {
        status: e.data.status,
        attempt: e.data.attempt,
        role: e.data.role,
        ...(struggled ? { struggled } : {}),
        updatedTs: e.ts,
      };
      // Later statuses of the same run (review, done) may omit the session; keep it.
      const sessionId =
        e.data.sessionId ?? (prev?.attempt === e.data.attempt ? prev.sessionId : undefined);
      if (sessionId) task.sessionId = sessionId;
      if (e.data.reason) task.reason = e.data.reason;
      q.tasks[e.data.taskId] = task;
      ensureRole(q, e.data.role);
      return true;
    }

    case "note.posted":
      if (!q.notes.some((n) => n.noteId === e.data.noteId)) {
        q.notes.push({
          noteId: e.data.noteId,
          fromRole: e.data.fromRole,
          ...(e.data.toRole ? { toRole: e.data.toRole } : {}),
          text: e.data.text,
          ts: e.ts,
        });
        // Keep the thread in time order even if notes arrive out of order.
        q.notes.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      }
      return true;

    case "change_request.opened": {
      const prev = q.changeRequests[e.data.requestId];
      q.changeRequests[e.data.requestId] = {
        requestId: e.data.requestId,
        fromRole: e.data.fromRole,
        toRole: e.data.toRole,
        text: e.data.text,
        ...(e.data.taskId ? { taskId: e.data.taskId } : {}),
        // Resolved before the opening landed: keep the outcome.
        state: prev?.state ?? "open",
        openedTs: e.ts,
        ...(prev?.resolvedTs ? { resolvedTs: prev.resolvedTs } : {}),
      };
      return true;
    }

    case "change_request.resolved": {
      // Resolved before it was opened (out of order): the opening fills in the rest.
      const cr = q.changeRequests[e.data.requestId] ?? {
        requestId: e.data.requestId,
        fromRole: "",
        toRole: "",
        text: "",
        state: "open",
      };
      q.changeRequests[e.data.requestId] = cr;
      cr.state = e.data.outcome;
      cr.resolvedTs = e.ts;
      return true;
    }

    case "contract.frozen": {
      const prev = q.contracts[e.data.path];
      if (!prev || e.data.version >= prev.version)
        q.contracts[e.data.path] = { version: e.data.version, sha: e.data.sha, ts: e.ts };
      return true;
    }

    case "commit.created":
      if (!q.commits.some((c) => c.sha === e.data.sha))
        q.commits.push({
          sha: e.data.sha,
          role: e.data.role,
          taskId: e.data.taskId,
          files: e.data.files,
          ts: e.ts,
        });
      return true;

    case "ownership.violation": {
      const bounce = e.data.bounce ?? 1;
      const same = (v: OwnershipViolationState) =>
        v.taskId === e.data.taskId && v.attempt === e.data.attempt && (v.bounce ?? 1) === bounce;
      if (!q.violations.some(same))
        q.violations.push({
          role: e.data.role,
          taskId: e.data.taskId,
          attempt: e.data.attempt,
          ...(e.data.bounce !== undefined ? { bounce: e.data.bounce } : {}),
          paths: e.data.paths,
          ts: e.ts,
        });
      return true;
    }

    case "merge.started":
    case "merge.succeeded":
    case "merge.conflicted":
    case "merge.reverted": {
      const next = e.type.slice("merge.".length) as MergeState;
      const key = `${e.data.taskId}:${e.data.attempt}`;
      const m = q.merges[key] ?? {
        taskId: e.data.taskId,
        role: e.data.role,
        attempt: e.data.attempt,
        state: next,
        ts: e.ts,
      };
      q.merges[key] = m;
      if (MERGE_RANK[next] >= MERGE_RANK[m.state]) {
        m.state = next;
        m.ts = e.ts;
      }
      // Details accumulate whatever the order: a revert keeps the merged sha.
      if (e.type === "merge.succeeded") m.sha = e.data.sha;
      if (e.type === "merge.conflicted") m.paths = e.data.paths;
      if (e.type === "merge.reverted") {
        m.toSha = e.data.toSha;
        m.checkId = e.data.checkId;
      }
      return true;
    }

    case "check.ran": {
      const prev = q.checks[e.data.checkId];
      if (!prev || e.ts >= prev.ts)
        q.checks[e.data.checkId] = {
          ok: e.data.ok,
          runId: e.data.runId,
          ...(e.data.durationMs !== undefined ? { durationMs: e.data.durationMs } : {}),
          ...(e.data.outputPreview !== undefined ? { outputPreview: e.data.outputPreview } : {}),
          ts: e.ts,
        };
      return true;
    }

    case "budget.warned":
    case "budget.exhausted": {
      const key: BudgetKey = `${e.data.scope}:${e.data.scopeId}`;
      addOnce(e.type === "budget.warned" ? q.budget.warned : q.budget.exhausted, key);
      return true;
    }

    case "squad.budget_changed": {
      q.budgetChanges = (q.budgetChanges ?? 0) + 1;
      // Re-arm the levels of each changed scope for its new limit.
      const rearm = (key: BudgetKey) => {
        q.budget.warned = q.budget.warned.filter((k) => k !== key);
        q.budget.exhausted = q.budget.exhausted.filter((k) => k !== key);
      };
      if (e.data.budgetUsd !== q.budgetUsd) rearm(`squad:${q.id}`);
      q.budgetUsd = e.data.budgetUsd;
      for (const [roleId, usd] of Object.entries(e.data.roleBudgets ?? {})) {
        q.roleBudgets = { ...q.roleBudgets, [roleId]: usd };
        rearm(`role:${roleId}`);
      }
      return true;
    }

    case "squad.paused":
      q.pauseCount = (q.pauseCount ?? 0) + 1;
      q.paused = { reason: e.data.reason, ts: e.ts };
      return true;

    case "squad.resumed":
      q.resumeCount = (q.resumeCount ?? 0) + 1;
      // A late resume must not lift a newer pause.
      if (q.paused && q.paused.ts <= e.ts) delete q.paused;
      return true;

    case "task.added": {
      q.addedTasks ??= [];
      const added = q.addedTasks;
      if (!added.some((a) => a.task.id === e.data.task.id)) {
        added.push({
          task: e.data.task,
          origin: e.data.origin,
          ...(e.data.fromRole ? { fromRole: e.data.fromRole } : {}),
          ts: e.ts,
        });
        q.tasks[e.data.task.id] ??= {
          status: "pending",
          attempt: 1,
          role: e.data.task.role,
          updatedTs: e.ts,
        };
      }
      return true;
    }

    case "squad.delivered":
      q.delivered = { mode: e.data.mode, ref: e.data.ref, ts: e.ts };
      return true;
  }
  return true;
}

/**
 * The plan the squad runs: the approved (or proposed) plan plus the tasks added since, in
 * the order they came. Undefined before there is a plan.
 */
export function squadPlan(q: SquadState): SquadPlan | undefined {
  if (!q.plan) return undefined;
  const added = (q.addedTasks ?? [])
    .map((a) => a.task)
    .filter((t) => !q.plan?.tasks.some((p) => p.id === t.id));
  return added.length ? { ...q.plan, tasks: [...q.plan.tasks, ...added] } : q.plan;
}

/** A role's budget: what the user set after approval, else the plan's (none when neither). */
export function roleBudget(q: SquadState, roleId: string): number | undefined {
  return q.roleBudgets?.[roleId] ?? q.plan?.roles.find((r) => r.id === roleId)?.budgetUsd;
}

/** The squad a session works for, if any. */
export function squadOfSession(state: GravitaState, sessionId: string): SquadState | undefined {
  const squadId = state.sessions[sessionId]?.squadId;
  return squadId ? state.squads?.[squadId] : undefined;
}
