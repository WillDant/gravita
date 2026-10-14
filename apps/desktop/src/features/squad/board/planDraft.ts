import { outsideOwnership, type PlanIssue } from "@gravita/core";
import type { PlanTask, SquadPlan } from "@gravita/protocol";
import type { SquadAgentProvider } from "@gravita/protocol/constants";

// Light edits the Board allows on a proposed plan, as pure functions: rename or rewrite a
// task, remove one (its dependants stop waiting for it), move one to a role that owns
// every path it writes. The Board re-runs validatePlan on the result after every edit.

export function editTask(
  plan: SquadPlan,
  taskId: string,
  patch: Partial<Pick<PlanTask, "title" | "plainSummary">>,
): SquadPlan {
  return {
    ...plan,
    tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
  };
}

/** Puts a role on another provider (a mixed squad's Board); validatePlan judges the result. */
export function setRoleProvider(
  plan: SquadPlan,
  roleId: string,
  provider: SquadAgentProvider,
): SquadPlan {
  return {
    ...plan,
    roles: plan.roles.map((r) => (r.id === roleId ? { ...r, provider } : r)),
  };
}

/** Removes a task; tasks that depended on it no longer do (their ids are returned). */
export function removeTask(
  plan: SquadPlan,
  taskId: string,
): { plan: SquadPlan; unblocked: string[] } {
  const unblocked: string[] = [];
  const tasks = plan.tasks
    .filter((t) => t.id !== taskId)
    .map((t) => {
      if (!t.dependsOn.includes(taskId)) return t;
      unblocked.push(t.id);
      return { ...t, dependsOn: t.dependsOn.filter((d) => d !== taskId) };
    });
  return { plan: { ...plan, tasks }, unblocked };
}

/** The paths a task writes that a role doesn't own (empty: the role can take it). */
export function wontFit(plan: SquadPlan, taskId: string, roleId: string): string[] {
  const task = plan.tasks.find((t) => t.id === taskId);
  return task ? outsideOwnership(plan, roleId, task.writes) : [];
}

/** Moves a task to another role, or says which paths stop it. */
export function moveTask(
  plan: SquadPlan,
  taskId: string,
  roleId: string,
): { ok: true; plan: SquadPlan } | { ok: false; outside: string[] } {
  const outside = wontFit(plan, taskId, roleId);
  if (outside.length) return { ok: false, outside };
  return {
    ok: true,
    plan: {
      ...plan,
      tasks: plan.tasks.map((t) => (t.id === taskId ? { ...t, role: roleId } : t)),
    },
  };
}

export interface PinnedIssues {
  /** By task id. */
  tasks: Map<string, PlanIssue[]>;
  /** By role id. */
  roles: Map<string, PlanIssue[]>;
  /** By check id. */
  checks: Map<string, PlanIssue[]>;
  /** Issues that point at nothing on the Board (shared paths, contracts, the plan). */
  general: PlanIssue[];
}

const AT = /^(tasks|roles|checks)\[(\d+)\]/;

/** Pins each issue to the card, role or check its path points at ("tasks[2].writes[0]"). */
export function pinIssues(plan: SquadPlan, issues: readonly PlanIssue[]): PinnedIssues {
  const out: PinnedIssues = { tasks: new Map(), roles: new Map(), checks: new Map(), general: [] };
  const add = (map: Map<string, PlanIssue[]>, key: string, issue: PlanIssue) =>
    map.set(key, [...(map.get(key) ?? []), issue]);
  for (const issue of issues) {
    const m = issue.path ? AT.exec(issue.path) : null;
    const index = m ? Number(m[2]) : -1;
    if (m?.[1] === "tasks" && plan.tasks[index]) add(out.tasks, plan.tasks[index].id, issue);
    else if (m?.[1] === "roles" && plan.roles[index]) add(out.roles, plan.roles[index].id, issue);
    else if (m?.[1] === "checks" && plan.checks[index])
      add(out.checks, plan.checks[index].id, issue);
    else out.general.push(issue);
  }
  return out;
}

/** Non-empty answers to the plan's questions, keyed by the question text. */
export function answersFor(
  questions: readonly string[],
  typed: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const a = typed[q]?.trim();
    if (a) out[q] = a;
  }
  return out;
}
