import type { SquadPlan, TaskStatus } from "@gravita/protocol";

// Which tasks to start now. Pure, so the engine can call it after every status change
// and the Board can preview "up next" with the same answer.

/** What the scheduler needs to know about a task's run: where it is and who has it. */
export interface TaskRun {
  status: TaskStatus;
  /** The role doing it now (a reassignment moves it off the plan's role). */
  role: string;
}

export interface ScheduleOptions {
  /** How many roles may have work in flight at once. Default 3. */
  maxRoles?: number;
}

export const DEFAULT_MAX_ROLES = 3;

/** Finished for scheduling purposes: dependants may start. */
const SETTLED: ReadonlySet<TaskStatus> = new Set(["done", "skipped"]);
/** Holds the role's worktree: running, or waiting at the commit/merge gate. */
const BUSY: ReadonlySet<TaskStatus> = new Set(["running", "review"]);
const STARTABLE: ReadonlySet<TaskStatus> = new Set(["pending", "ready"]);

// A plan task the engine hasn't recorded yet is pending, with the plan's role.
const runOf = (
  plan: SquadPlan,
  tasks: Record<string, TaskRun>,
  id: string,
): TaskRun | undefined => {
  const run = tasks[id];
  if (run) return run;
  const t = plan.tasks.find((x) => x.id === id);
  return t ? { status: "pending", role: t.role } : undefined;
};

/**
 * Task ids to start now, in plan order. A task starts when it's pending/ready, every
 * dependency is done or skipped, its role has nothing running or in review, and fewer
 * than `maxRoles` roles are busy. While any foundation task is unsettled, only
 * foundation tasks may start.
 */
export function nextTasks(
  plan: SquadPlan,
  tasks: Record<string, TaskRun>,
  opts: ScheduleOptions = {},
): string[] {
  const maxRoles = opts.maxRoles ?? DEFAULT_MAX_ROLES;
  const settled = (id: string) => {
    const run = runOf(plan, tasks, id);
    return run !== undefined && SETTLED.has(run.status);
  };
  const foundationOpen = plan.tasks.some((t) => t.foundation && !settled(t.id));

  const busy = new Set<string>();
  for (const t of plan.tasks) {
    const run = runOf(plan, tasks, t.id);
    if (run && BUSY.has(run.status)) busy.add(run.role);
  }

  const start: string[] = [];
  for (const t of plan.tasks) {
    const run = runOf(plan, tasks, t.id);
    if (!run || !STARTABLE.has(run.status)) continue;
    if (foundationOpen && !t.foundation) continue;
    if (!t.dependsOn.every(settled)) continue;
    if (busy.has(run.role) || busy.size >= maxRoles) continue;
    busy.add(run.role);
    start.push(t.id);
  }
  return start;
}

export interface SquadProgress {
  /** Done or skipped. */
  done: number;
  total: number;
  failed: number;
  /** Running or in review. */
  running: number;
  blocked: number;
}

/** Counts over the plan's tasks; a task not yet recorded counts as pending. */
export function squadProgress(plan: SquadPlan, tasks: Record<string, TaskRun>): SquadProgress {
  const p: SquadProgress = { done: 0, total: plan.tasks.length, failed: 0, running: 0, blocked: 0 };
  for (const t of plan.tasks) {
    const status = runOf(plan, tasks, t.id)?.status ?? "pending";
    if (SETTLED.has(status)) p.done++;
    else if (BUSY.has(status)) p.running++;
    else if (status === "failed") p.failed++;
    else if (status === "blocked") p.blocked++;
  }
  return p;
}

/** Every plan task is done or skipped. */
export function isComplete(plan: SquadPlan, tasks: Record<string, TaskRun>): boolean {
  return plan.tasks.every((t) => {
    const run = runOf(plan, tasks, t.id);
    return run !== undefined && SETTLED.has(run.status);
  });
}
