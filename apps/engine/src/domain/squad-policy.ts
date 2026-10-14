import {
  AUTO_MODELS,
  autoSubagentModel,
  estimatePlanCost,
  PLANNER_TOKENS,
  pickModel,
  roleProviderOf,
  tokenCost,
} from "@gravita/core";
import type {
  AgentProvider,
  PlanRole,
  SquadModels,
  SquadPhase,
  SquadPlan,
  SquadProviders,
} from "@gravita/protocol";

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

/**
 * The provider of squad sessions that name none: a squad made before Codex roles, and the
 * briefing and planner of every squad but a Codex-only one.
 */
export const SQUAD_PROVIDER: AgentProvider = "claude";

/** The provider a role's sessions run on, by the squad's choice (core's roleProviderOf). */
export function roleProvider(
  role: Pick<PlanRole, "provider"> | undefined,
  providers?: SquadProviders,
): AgentProvider {
  return roleProviderOf(providers, role);
}

/**
 * How a squad session's subagents run. Each runtime turns it into its own settings (Claude
 * Code: environment variables); absent fields leave the agent's defaults alone.
 */
export interface SubagentPolicy {
  /** The model of subagents whose definition names none. */
  model?: string;
  /** Subagents running at once. */
  maxConcurrent?: number;
  /** How deep subagents may spawn their own. */
  maxDepth?: number;
}

/** Role sessions may fan out, but boundedly. */
export const ROLE_SUBAGENT_LIMITS: Readonly<Required<Omit<SubagentPolicy, "model">>> = {
  maxConcurrent: 4,
  maxDepth: 2,
};

/**
 * Subagents of every squad session (briefing, planner, roles), plus the fan-out bounds of
 * role sessions. Under Automatic they run on the cheapest tier: an explicit model on the
 * call or in an agent's definition still wins. Fixed models leave the agent's defaults alone.
 */
export function squadSubagents(
  models: SquadModels,
  o: { role?: boolean; provider?: AgentProvider } = {},
): SubagentPolicy {
  const provider = o.provider ?? SQUAD_PROVIDER;
  // A provider without a tier table (core's PROVIDER_MODELS) keeps its own subagent model.
  const model =
    models.mode === "auto" && provider === "claude" ? autoSubagentModel(provider) : undefined;
  return { ...(o.role ? ROLE_SUBAGENT_LIMITS : {}), ...(model ? { model } : {}) };
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
  providers?: SquadProviders,
): number {
  const task = plan.tasks.find((t) => t.id === taskId);
  const role = plan.roles.find((r) => r.id === task?.role);
  if (role?.budgetUsd) return Math.min(role.budgetUsd, squadBudgetUsd);
  const est = estimatePlanCost(plan, models, model ? { [taskId]: model } : {}, providers);
  const tasksUsd = est.totalUsd - est.plannerUsd;
  const share = tasksUsd > 0 ? (est.byTask[taskId] ?? 0) / tasksUsd : 1 / plan.tasks.length;
  return Math.max(0.01, Math.min(squadBudgetUsd, squadBudgetUsd * share * TASK_HEADROOM));
}

// Plan budgets. A plan squad's budget is a share of a plan window, which only the provider
// can measure (account-wide, a few minutes behind). Its sessions still get a dollar cap, but
// only as a safety net against a runaway session between two readings: a generous multiple
// of the estimate, never the budget. Claude Code reports API-equivalent dollars even on a
// subscription, so a tight cap there would stop work the plan still has room for. Codex
// reports no dollars and takes no cap: its sessions are bounded by the plan share alone.

/** How often plan usage is read while a plan squad works. */
export const PLAN_USAGE_POLL_MS = 3 * 60_000;
/** While a working plan squad has no baseline yet, plan usage is read this often. */
export const PLAN_BASELINE_POLL_MS = 10_000;
/** The least time between two reads the UI asks for (a chat or squad screen opening). */
export const PLAN_USAGE_MIN_GAP_MS = 60_000;
/**
 * A plan squad's count of a window is noted (`budget.measured`) each time it rose by this
 * many points since the last note, so a restart loses less than this.
 */
export const PLAN_MEASURE_STEP_POINTS = 1;
/** A reading older than this when the squad starts building isn't its baseline. */
export const PLAN_BASELINE_MAX_AGE_MS = 10 * 60_000;
/** How long a usage read on a live session may take before Gravita gives up on it. */
export const PLAN_USAGE_READ_TIMEOUT_MS = 10_000;
/** A plan squad session's dollar cap is this many times its estimate… */
export const PLAN_CAP_FACTOR = 4;
/** …and at least this much. */
export const PLAN_TASK_CAP_MIN_USD = 5;
export const PLAN_PLANNER_CAP_MIN_USD = 5;
export const PLAN_BRIEFING_CAP_MIN_USD = 2.5;

/** A plan squad task's safety cap: a multiple of its estimate at the model its run uses. */
export function planTaskCap(
  plan: SquadPlan,
  models: SquadModels,
  taskId: string,
  model?: string,
  providers?: SquadProviders,
): number {
  const est = estimatePlanCost(plan, models, model ? { [taskId]: model } : {}, providers);
  return Math.max(PLAN_TASK_CAP_MIN_USD, (est.byTask[taskId] ?? 0) * PLAN_CAP_FACTOR);
}

/** The planner's safety cap in a plan squad. */
export function planPlannerCap(models: SquadModels, provider: AgentProvider = "claude"): number {
  const est = tokenCost(
    pickModel({ models, phase: "planning", provider }),
    PLANNER_TOKENS,
    provider,
  );
  return Math.max(PLAN_PLANNER_CAP_MIN_USD, est * PLAN_CAP_FACTOR);
}

/** The briefing's safety cap in a plan squad (it reads and asks: half the planner's). */
export function planBriefingCap(models: SquadModels, provider: AgentProvider = "claude"): number {
  return Math.max(PLAN_BRIEFING_CAP_MIN_USD, planPlannerCap(models, provider) / 2);
}
