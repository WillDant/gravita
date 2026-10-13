import {
  type AddedTask,
  type GravitaState,
  roleBudget,
  type SessionState,
  type SquadMerge,
  type SquadState,
  squadPlan,
} from "@gravita/core";
import type { PlanRole, PlanTask, SquadPlan, TaskStatus } from "@gravita/protocol";
import { roleCode, roleColorKey } from "@/shared/presenters/squad";

// The squad as its screen reads it: roles with their colour, spend and session; tasks in
// the order the map draws them, with where each one stands. Pure.

export interface RoleView {
  id: string;
  name: string;
  kind: PlanRole["kind"];
  colorKey: string;
  code: string;
  owns: string[];
  charter: string;
  budgetUsd?: number;
  spentUsd: number;
  sessionId?: string;
  session?: SessionState;
}

export interface TaskView {
  task: PlanTask;
  status: TaskStatus;
  attempt: number;
  /** The role doing it now (a reassignment moves it off the plan's role). */
  role: string;
  sessionId?: string;
  reason?: string;
  updatedTs?: string;
  /** The latest merge attempt. */
  merge?: SquadMerge;
  /** Set for a task added after approval. */
  added?: AddedTask;
}

export interface SquadView {
  plan?: SquadPlan;
  roles: RoleView[];
  /** In map order: foundation first, dependencies before dependants, then plan order. */
  tasks: TaskView[];
  task: (id: string) => TaskView | undefined;
  role: (id: string) => RoleView | undefined;
  planner?: { sessionId?: string; session?: SessionState; spentUsd: number };
}

/** The planner as a role-like view (it isn't a plan role, but it has a line colour). */
export const PLANNER_KEY = "planner";

/**
 * Task ids in drawing order: foundation tasks first, every task after the tasks it
 * depends on, ties kept in plan order. Stable for a given plan, so stations never jump
 * as statuses change.
 */
export function taskOrder(plan: Pick<SquadPlan, "tasks">): string[] {
  const ids = new Set(plan.tasks.map((t) => t.id));
  const out: string[] = [];
  const placed = new Set<string>();
  const ready = (t: PlanTask) => t.dependsOn.every((d) => placed.has(d) || !ids.has(d));
  const pass = (pool: PlanTask[]) => {
    let left = pool.filter((t) => !placed.has(t.id));
    while (left.length) {
      const next = left.find(ready) ?? left[0]!; // a cycle: break it in plan order
      out.push(next.id);
      placed.add(next.id);
      left = left.filter((t) => t !== next);
    }
  };
  pass(plan.tasks.filter((t) => t.foundation));
  pass(plan.tasks);
  return out;
}

/** The latest merge attempt of each task. */
export function latestMerges(q: Pick<SquadState, "merges">): Map<string, SquadMerge> {
  const out = new Map<string, SquadMerge>();
  for (const m of Object.values(q.merges)) {
    const cur = out.get(m.taskId);
    if (!cur || m.attempt >= cur.attempt) out.set(m.taskId, m);
  }
  return out;
}

export function squadView(state: GravitaState, q: SquadState): SquadView {
  const plan = squadPlan(q);
  const roles: RoleView[] = (plan?.roles ?? [])
    .filter((r) => r.kind !== "planner")
    .map((r) => {
      const run = q.roles[r.id];
      const sessionId = run?.currentSessionId;
      const session = sessionId ? state.sessions[sessionId] : undefined;
      const budget = roleBudget(q, r.id);
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        colorKey: roleColorKey(r, plan),
        code: roleCode(r),
        owns: r.owns,
        charter: r.charter,
        ...(budget !== undefined ? { budgetUsd: budget } : {}),
        spentUsd: run?.spentUsd ?? 0,
        ...(sessionId ? { sessionId } : {}),
        ...(session ? { session } : {}),
      };
    });
  const merges = latestMerges(q);
  const added = new Map((q.addedTasks ?? []).map((a) => [a.task.id, a]));
  const byId = new Map(plan?.tasks.map((t) => [t.id, t]) ?? []);
  const tasks: TaskView[] = plan
    ? taskOrder(plan).flatMap((id) => {
        const task = byId.get(id);
        if (!task) return [];
        const run = q.tasks[id];
        const merge = merges.get(id);
        const extra = added.get(id);
        return [
          {
            task,
            status: run?.status ?? "pending",
            attempt: run?.attempt ?? 0,
            role: run?.role ?? task.role,
            ...(run?.sessionId ? { sessionId: run.sessionId } : {}),
            ...(run?.reason ? { reason: run.reason } : {}),
            ...(run?.updatedTs ? { updatedTs: run.updatedTs } : {}),
            ...(merge ? { merge } : {}),
            ...(extra ? { added: extra } : {}),
          },
        ];
      })
    : [];
  const taskById = new Map(tasks.map((t) => [t.task.id, t]));
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const plannerRun = q.roles[PLANNER_KEY];
  const plannerSessionId = plannerRun?.currentSessionId;
  const plannerSession = plannerSessionId ? state.sessions[plannerSessionId] : undefined;
  return {
    ...(plan ? { plan } : {}),
    roles,
    tasks,
    task: (id) => taskById.get(id),
    role: (id) => roleById.get(id),
    planner: {
      ...(plannerSessionId ? { sessionId: plannerSessionId } : {}),
      ...(plannerSession ? { session: plannerSession } : {}),
      spentUsd: plannerRun?.spentUsd ?? 0,
    },
  };
}

/** A task's title by id (a dependency that left the plan shows as its id). */
export function titleOf(plan: Pick<SquadPlan, "tasks"> | undefined, id: string): string {
  return plan?.tasks.find((t) => t.id === id)?.title ?? id;
}

/** Roles that could take a task: they own every path it writes (and aren't its role now). */
export function reassignable(
  plan: SquadPlan,
  task: PlanTask,
  current: string,
  outside: (plan: SquadPlan, roleId: string, paths: readonly string[]) => string[],
): { role: PlanRole; outside: string[] }[] {
  return plan.roles
    .filter((r) => r.kind !== "planner" && r.id !== current)
    .map((role) => ({ role, outside: outside(plan, role.id, task.writes) }));
}
