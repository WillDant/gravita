import { AUTO_MODELS, AUTO_SUBAGENT_MODEL, estimatePlanCost } from "@gravita/core";
import type { SquadModels, SquadPhase, SquadPlan } from "@gravita/protocol";

// The numbers that bound a squad: how much runs at once, how often Gravita retries on its
// own, and how the budget is sliced. Squad sessions don't count against the chat limit.

/** Role sessions of one squad at once (one task per role, so at most this many roles busy). */
export const MAX_ROLE_SESSIONS_PER_SQUAD = 3;
/** Squads with work in flight (planning, foundation, build, verify) at once. */
export const MAX_RUNNING_SQUADS = 2;
/** Runs of a task Gravita starts by itself; beyond that the task waits for the user. */
export const MAX_AUTO_ATTEMPTS = 2;
/** Ownership violations sent back to the role within one run; the next one fails the task. */
export const MAX_BOUNCES = 2;
/** Planner proposals per planning round before the squad fails. */
export const MAX_PLAN_ATTEMPTS = 3;
/** Rounds of bug fixing after red final checks before the squad waits for the user. */
export const MAX_VERIFY_ROUNDS = 2;
export const PLANNER_MAX_TURNS = 30;
/** Turns per user message in the briefing conversation. */
export const BRIEFING_MAX_TURNS = 30;
/** The role id of the planner's sessions (the briefing and the planning runs). */
export const PLANNER_ROLE_ID = "planner";
export const ROLE_MAX_TURNS = 200;
/** A budget scope warns once at this share. */
export const BUDGET_WARN_RATIO = 0.75;
/** How long a session gets to end its turn after an interrupt before it is disposed. */
export const STOP_GRACE_MS = 5_000;

/** New squads run the Automatic (cost-benefit) model policy unless the user picks otherwise. */
export const DEFAULT_SQUAD_MODELS: Readonly<SquadModels> = AUTO_MODELS;

/**
 * The models a squad.create asks for: Automatic when none (or `mode: "auto"`, filled in
 * from the defaults); otherwise fixed, as before the policy existed (a client that sends
 * only planner and roles means exactly those).
 */
export function squadModels(requested?: SquadModels): SquadModels {
  if (!requested) return { ...DEFAULT_SQUAD_MODELS };
  if (requested.mode === "auto") return { ...AUTO_MODELS, ...requested };
  return { ...requested, mode: "fixed" };
}

/** Role sessions may fan out, but boundedly. */
export const ROLE_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4",
  CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "2",
};

/**
 * Environment for every squad session (briefing, planner, roles). Under Automatic, subagents
 * run on Haiku: Claude Code reads CLAUDE_CODE_SUBAGENT_MODEL for any subagent whose
 * definition doesn't name a model (an explicit model on the Agent call or in an agent's
 * definition still wins, and Explore already runs on Haiku by default). Fixed models leave
 * Claude Code's defaults alone.
 */
export function squadEnv(models: SquadModels): Record<string, string> {
  return models.mode === "auto" ? { CLAUDE_CODE_SUBAGENT_MODEL: AUTO_SUBAGENT_MODEL } : {};
}

/** Phases with work in flight; a squad in one of these counts as running. */
export const ACTIVE_PHASES: ReadonlySet<SquadPhase> = new Set([
  "planning",
  "foundation",
  "build",
  "verify",
]);

/** The planner's slice of the squad budget: a tenth, at least $1 (never more than the budget). */
export function plannerBudget(squadBudgetUsd: number): number {
  return Math.min(squadBudgetUsd, Math.max(1, squadBudgetUsd * 0.1));
}

/**
 * The briefing conversation's slice of the squad budget: a twentieth, at least $0.50 (never
 * more than the budget). Modest on purpose: it reads and asks, it doesn't plan.
 */
export function briefingBudget(squadBudgetUsd: number): number {
  return Math.min(squadBudgetUsd, Math.max(0.5, squadBudgetUsd * 0.05));
}

/** Headroom on a task's share: the estimate is a ballpark, a share is not a hard quote. */
const TASK_HEADROOM = 1.5;

/**
 * A task's own budget (the session's maxBudgetUsd): the role's budget when the plan sets
 * one, else the squad budget times the task's share of the estimated cost, with headroom.
 * The share prices the task at `model`, the one its run actually uses (an escalated or
 * retried run costs more), and the other tasks at the squad's policy. Never more than the
 * squad budget, never less than a cent.
 */
export function taskBudget(
  plan: SquadPlan,
  models: SquadModels,
  squadBudgetUsd: number,
  taskId: string,
  model?: string,
): number {
  const task = plan.tasks.find((t) => t.id === taskId);
  const role = plan.roles.find((r) => r.id === task?.role);
  if (role?.budgetUsd) return Math.min(role.budgetUsd, squadBudgetUsd);
  const est = estimatePlanCost(plan, models, model ? { [taskId]: model } : {});
  const tasksUsd = est.totalUsd - est.plannerUsd;
  const share = tasksUsd > 0 ? (est.byTask[taskId] ?? 0) / tasksUsd : 1 / plan.tasks.length;
  return Math.max(0.01, Math.min(squadBudgetUsd, squadBudgetUsd * share * TASK_HEADROOM));
}
