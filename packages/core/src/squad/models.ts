import type { AgentProvider, PlanTask, SquadModels, SquadPlan } from "@gravita/protocol";
import { overlaps } from "./paths";
import type { SquadState } from "./state";

// Which model runs what in a squad. Shared by the engine (which starts the sessions) and
// the UI (which estimates and labels them), so both always agree.
//
// The Automatic policy spends where it pays: the briefing is a conversation, so the middle
// tier; the plan is the single highest-leverage run, so the top tier, once; everyday tasks
// run on the middle tier, and the tasks whose mistakes ripple through the whole squad (the
// foundation, a shared contract, a large task) on the top one. A task that struggles steps
// up a tier for its next run. Tiers are per provider; Claude's are Haiku, Sonnet and Opus.

/** How strong (and costly) a model is within its provider's line-up. */
export type ModelTier = "low" | "mid" | "high";

/** Cheapest first: an escalation moves one step to the right, and stops at the end. */
export const TIER_LADDER: readonly ModelTier[] = ["low", "mid", "high"];

/** Each provider's model for each tier (aliases its CLI accepts). Codex joins later. */
export const PROVIDER_MODELS = {
  claude: { low: "haiku", mid: "sonnet", high: "opus" },
} as const satisfies Partial<Record<AgentProvider, Readonly<Record<ModelTier, string>>>>;

/** A provider with a tier table: what the squad model policy can run. */
export type ModelProvider = keyof typeof PROVIDER_MODELS;

/** Claude's model families, one per tier. */
export type ModelFamily = (typeof PROVIDER_MODELS)["claude"][ModelTier];

/**
 * The tier of a model string within `provider`'s line-up: the tier whose model name it
 * contains, and the middle tier for "default" and anything unknown (never another
 * provider's guess).
 */
export function modelTier(model: string, provider: ModelProvider = "claude"): ModelTier {
  const m = model.toLowerCase();
  const names = PROVIDER_MODELS[provider];
  if (m.includes(names.high)) return "high";
  if (m.includes(names.low)) return "low";
  return "mid";
}

/** A model string as provider and tier. */
export function classifyModel(
  model: string,
  provider: ModelProvider = "claude",
): { provider: ModelProvider; tier: ModelTier } {
  return { provider, tier: modelTier(model, provider) };
}

/** The model a provider runs for a tier. */
export function tierModel(provider: ModelProvider, tier: ModelTier): string {
  return PROVIDER_MODELS[provider][tier];
}

/** Claude's family of a model string; "default" and anything unknown count as sonnet. */
export function modelFamily(model: string): ModelFamily {
  return PROVIDER_MODELS.claude[modelTier(model, "claude")];
}

/** The Automatic policy in a provider's tiers. */
function autoModels(provider: ModelProvider): Readonly<SquadModels> {
  const names = PROVIDER_MODELS[provider];
  return { mode: "auto", briefing: names.mid, planner: names.high, roles: names.mid };
}

/** The Automatic policy of each provider. */
export const AUTO_MODELS_BY_PROVIDER: Readonly<Record<ModelProvider, Readonly<SquadModels>>> = {
  claude: autoModels("claude"),
};

/** Claude's Automatic policy, the default for new squads. */
export const AUTO_MODELS: Readonly<SquadModels> = AUTO_MODELS_BY_PROVIDER.claude;

/**
 * Subagents (Explore and the like) of every squad session under the Automatic policy: they
 * search and read for their parent, which is what the cheapest tier is good at.
 */
export function autoSubagentModel(provider: ModelProvider = "claude"): string {
  return tierModel(provider, "low");
}

/** Claude's subagent model under Automatic. */
export const AUTO_SUBAGENT_MODEL = autoSubagentModel("claude");

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

/** `model` moved `steps` tiers up in its provider; the model itself when that changes nothing. */
export function stepUp(model: string, steps: number, provider: ModelProvider = "claude"): string {
  if (steps <= 0) return model;
  const tier = modelTier(model, provider);
  const from = TIER_LADDER.indexOf(tier);
  const to = TIER_LADDER[Math.min(TIER_LADDER.length - 1, from + steps)] ?? "high";
  return to === tier ? model : tierModel(provider, to);
}

export type ModelPhase = "briefing" | "planning" | "task";

export interface PickModelInput {
  models: SquadModels;
  /** Whose tiers the policy climbs (Claude when absent). */
  provider?: ModelProvider;
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
 * leverage, and one more per escalation, up to the provider's top tier (Opus for Claude).
 */
export function pickModel(i: PickModelInput): string {
  const { models } = i;
  const provider = i.provider ?? "claude";
  const auto = models.mode === "auto";
  if (i.phase === "briefing")
    return (
      models.briefing ??
      (auto
        ? (AUTO_MODELS_BY_PROVIDER[provider].briefing ?? tierModel(provider, "mid"))
        : models.planner)
    );
  if (i.phase === "planning" || !i.task) return models.planner;
  const roleId = i.roleId ?? i.task.role;
  const own = i.plan?.roles.find((r) => r.id === roleId)?.model;
  if (own) return own;
  if (!auto) return models.roles;
  const lift = i.plan && isHighLeverage(i.plan, i.task) ? 1 : 0;
  return stepUp(models.roles, lift + Math.max(0, i.escalations ?? 0), provider);
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
