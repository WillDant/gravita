import type { PlanTask, SquadModels, SquadPlan } from "@gravita/protocol";
import { overlaps } from "./paths";
import type { SquadState } from "./state";

// Which model runs what in a squad. Shared by the engine (which starts the sessions) and
// the UI (which estimates and labels them), so both always agree.
//
// The Automatic policy spends where it pays: the briefing is a conversation, so Sonnet;
// the plan is the single highest-leverage run, so Opus, once; everyday tasks run on Sonnet,
// and the tasks whose mistakes ripple through the whole squad (the foundation, a shared
// contract, a large task) on Opus. A task that struggles steps up a tier for its next run.

export type ModelFamily = "opus" | "sonnet" | "haiku";

/** Cheapest first: an escalation moves one step to the right, and stops at the end. */
const LADDER: readonly ModelFamily[] = ["haiku", "sonnet", "opus"];

/** The family of a model string; "default" and anything unknown count as sonnet. */
export function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("haiku")) return "haiku";
  return "sonnet";
}

/** The Automatic policy, the default for new squads. */
export const AUTO_MODELS: Readonly<SquadModels> = {
  mode: "auto",
  briefing: "sonnet",
  planner: "opus",
  roles: "sonnet",
};

/**
 * Subagents (Explore and the like) of every squad session under the Automatic policy: they
 * search and read for their parent, which is what the cheapest model is good at.
 */
export const AUTO_SUBAGENT_MODEL = "haiku";

/** What the new-squad panel offers: the policy, or one model for everything. */
export type ModelChoice = "auto" | "opus" | "sonnet";

export const MODEL_CHOICES: Readonly<Record<ModelChoice, Readonly<SquadModels>>> = {
  auto: AUTO_MODELS,
  opus: { mode: "fixed", planner: "opus", roles: "opus" },
  sonnet: { mode: "fixed", planner: "sonnet", roles: "sonnet" },
};

/** The choice a squad's models amount to; undefined for any other mix (older squads). */
export function modelChoice(models: SquadModels): ModelChoice | undefined {
  if (models.mode === "auto") return "auto";
  const planner = modelFamily(models.planner);
  if (planner !== modelFamily(models.roles)) return undefined;
  if (models.briefing !== undefined && modelFamily(models.briefing) !== planner) return undefined;
  return planner === "haiku" ? undefined : planner;
}

/**
 * A task whose mistakes cost the most: a foundation task (everything builds on it), one
 * that writes a shared contract (every role reads it), or a large one.
 */
export function isHighLeverage(
  plan: Pick<SquadPlan, "contracts">,
  task: Pick<PlanTask, "size" | "writes" | "foundation">,
): boolean {
  if (task.foundation || task.size === "l") return true;
  return task.writes.some((w) => plan.contracts.some((c) => overlaps(w, c.path)));
}

/** `model` moved `steps` tiers up; the model itself when that changes nothing. */
function stepUp(model: string, steps: number): string {
  if (steps <= 0) return model;
  const from = LADDER.indexOf(modelFamily(model));
  const to = LADDER[Math.min(LADDER.length - 1, from + steps)] ?? "opus";
  return to === modelFamily(model) ? model : to;
}

export type ModelPhase = "briefing" | "planning" | "task";

export interface PickModelInput {
  models: SquadModels;
  phase: ModelPhase;
  /** For a task: the plan it belongs to (its roles and contracts). */
  plan?: Pick<SquadPlan, "roles" | "contracts">;
  task?: Pick<PlanTask, "role" | "size" | "writes" | "foundation">;
  /** The role doing the task now, when a reassignment moved it off `task.role`. */
  roleId?: string;
  /** Earlier runs of the task that struggled (see `taskEscalations`). */
  escalations?: number;
}

/**
 * The model for one run. A plan role's own `model` always wins (the user or the planner
 * chose it). Fixed models run as picked and never escalate. Under Automatic: the briefing
 * on `briefing`, planning on `planner`, a task on `roles`, one tier up when it is high
 * leverage, and one more per escalation, up to Opus.
 */
export function pickModel(i: PickModelInput): string {
  const { models } = i;
  const auto = models.mode === "auto";
  if (i.phase === "briefing")
    return models.briefing ?? (auto ? (AUTO_MODELS.briefing ?? "sonnet") : models.planner);
  if (i.phase === "planning" || !i.task) return models.planner;
  const roleId = i.roleId ?? i.task.role;
  const own = i.plan?.roles.find((r) => r.id === roleId)?.model;
  if (own) return own;
  if (!auto) return models.roles;
  const lift = i.plan && isHighLeverage(i.plan, i.task) ? 1 : 0;
  return stepUp(models.roles, lift + Math.max(0, i.escalations ?? 0));
}

/** How many earlier runs of a task struggled: each one is a tier up under Automatic. */
export function taskEscalations(q: Pick<SquadState, "tasks">, taskId: string): number {
  return q.tasks[taskId]?.struggled?.length ?? 0;
}

/**
 * The model a task's next run uses (its current one while it runs), from the projection:
 * the role doing it now, and the runs that struggled so far. Undefined for an unknown task.
 */
export function squadTaskModel(
  q: Pick<SquadState, "models" | "tasks">,
  plan: SquadPlan,
  taskId: string,
): string | undefined {
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) return undefined;
  const roleId = q.tasks[taskId]?.role;
  return pickModel({
    models: q.models,
    phase: "task",
    plan,
    task,
    ...(roleId ? { roleId } : {}),
    escalations: taskEscalations(q, taskId),
  });
}
