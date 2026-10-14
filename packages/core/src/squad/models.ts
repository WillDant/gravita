import type { AgentProvider, PlanTask, SquadModels, SquadPlan } from "@gravita/protocol";
import { overlaps } from "./paths";
import { roleProviderOf, type SquadProviderChoice } from "./providers";
import type { SquadState } from "./state";

// Which model runs what in a squad. Shared by the engine (which starts the sessions) and
// the UI (which estimates and labels them), so both always agree.
//
// The Automatic policy spends where it pays: the briefing is a conversation, so the middle
// tier; the plan is the single highest-leverage run, so the top tier, once; everyday tasks
// run on the middle tier, and the tasks whose mistakes ripple through the whole squad (the
// foundation, a shared contract, a large task) on the top one. A task that struggles steps
// up a tier for its next run. Tiers are per provider; Claude's are Haiku, Sonnet and Opus.
//
// Codex's tiers are one model at three reasoning efforts: the account's default model
// (what `model/list` marks `isDefault`) at low, medium and high effort. Codex's catalog
// names its models (gpt-6.1-sol, gpt-6-astra, gpt-6-luna…) without saying which is cheaper or
// stronger, while effort is the knob Codex itself documents for cost against quality, so
// the policy climbs effort rather than guessing at names. A Codex tier is written
// "<model>@<effort>", with "default" for the account's default model; the engine resolves
// "default" and checks the effort against `model/list` when the session starts.

/** How strong (and costly) a model is within its provider's line-up. */
export type ModelTier = "low" | "mid" | "high";

/** Cheapest first: an escalation moves one step to the right, and stops at the end. */
export const TIER_LADDER: readonly ModelTier[] = ["low", "mid", "high"];

/** Codex's model for "whatever the account's default is", in a tier's spelling. */
export const CODEX_DEFAULT_MODEL = "default";

/** Codex's reasoning effort for each tier. */
export const CODEX_EFFORTS: Readonly<Record<ModelTier, string>> = {
  low: "low",
  mid: "medium",
  high: "high",
};

/**
 * Each provider's model for each tier (aliases its CLI accepts; Codex's are resolved by the
 * engine, see above).
 */
export const PROVIDER_MODELS = {
  claude: { low: "haiku", mid: "sonnet", high: "opus" },
  codex: { low: "default@low", mid: "default@medium", high: "default@high" },
} as const satisfies Record<AgentProvider, Readonly<Record<ModelTier, string>>>;

/** A provider with a tier table: what the squad model policy can run. */
export type ModelProvider = keyof typeof PROVIDER_MODELS;

/** Claude's model families, one per tier. */
export type ModelFamily = (typeof PROVIDER_MODELS)["claude"][ModelTier];

/** A Codex model string as its model (undefined: the account's default) and effort. */
export function parseCodexModel(model: string): { model?: string; effort?: string } {
  const at = model.lastIndexOf("@");
  const name = (at >= 0 ? model.slice(0, at) : model).trim();
  const effort =
    at >= 0
      ? model
          .slice(at + 1)
          .trim()
          .toLowerCase()
      : "";
  return {
    ...(name && name !== CODEX_DEFAULT_MODEL ? { model: name } : {}),
    ...(effort ? { effort } : {}),
  };
}

/** A Codex model string from a model (undefined: the default) and an effort. */
export function codexModel(model: string | undefined, effort?: string): string {
  const name = model ?? CODEX_DEFAULT_MODEL;
  return effort ? `${name}@${effort}` : name;
}

/** Whether a model string is spelled Codex's way (an effort, or an OpenAI model name). */
export function isCodexModel(model: string): boolean {
  return model.includes("@") || /^(gpt|o\d|codex)/i.test(model.trim());
}

const LOW_EFFORTS = new Set(["none", "minimal", "low"]);
const HIGH_EFFORTS = new Set(["high", "xhigh", "ultra"]);

/**
 * The tier of a model string within `provider`'s line-up. Claude: the tier whose model
 * name it contains. Codex: its effort. The middle tier for "default" and anything unknown
 * (never another provider's guess).
 */
export function modelTier(model: string, provider: ModelProvider = "claude"): ModelTier {
  if (provider === "codex") {
    const effort = parseCodexModel(model).effort;
    if (effort && LOW_EFFORTS.has(effort)) return "low";
    if (effort && HIGH_EFFORTS.has(effort)) return "high";
    return "mid";
  }
  const m = model.toLowerCase();
  const names = PROVIDER_MODELS[provider];
  if (m.includes(names.high)) return "high";
  if (m.includes(names.low)) return "low";
  return "mid";
}

/**
 * A model string in `provider`'s terms: as it is when it already is one of the provider's,
 * else the provider's model of the same tier. A mixed squad keeps one model policy (written
 * in Claude's names: "sonnet" for everyday work); its Codex roles run the same tier on Codex.
 */
export function inProvider(model: string, provider: ModelProvider): string {
  const codex = isCodexModel(model);
  if (provider === "codex") return codex ? model : tierModel("codex", modelTier(model, "claude"));
  return codex ? tierModel("claude", modelTier(model, "codex")) : model;
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
  codex: autoModels("codex"),
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

/**
 * `model` moved `steps` tiers up in its provider; the model itself when that changes nothing.
 * A named Codex model keeps its name and climbs its effort.
 */
export function stepUp(model: string, steps: number, provider: ModelProvider = "claude"): string {
  if (steps <= 0) return model;
  const tier = modelTier(model, provider);
  const from = TIER_LADDER.indexOf(tier);
  const to = TIER_LADDER[Math.min(TIER_LADDER.length - 1, from + steps)] ?? "high";
  if (to === tier) return model;
  if (provider === "codex") return codexModel(parseCodexModel(model).model, CODEX_EFFORTS[to]);
  return tierModel(provider, to);
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
 * The model for one run, in `provider`'s terms (a policy written in another provider's
 * names runs the same tier; see `inProvider`). A plan role's own `model` always wins (the
 * user or the planner chose it). Fixed models run as picked and never escalate. Under
 * Automatic: the briefing on `briefing`, planning on `planner`, a task on `roles`, one tier
 * up when it is high leverage, and one more per escalation, up to the provider's top tier
 * (Opus for Claude, high effort for Codex).
 */
export function pickModel(i: PickModelInput): string {
  const { models } = i;
  const provider = i.provider ?? "claude";
  const auto = models.mode === "auto";
  const own = (m: string) => inProvider(m, provider);
  if (i.phase === "briefing")
    return own(
      models.briefing ??
        (auto
          ? (AUTO_MODELS_BY_PROVIDER[provider].briefing ?? tierModel(provider, "mid"))
          : models.planner),
    );
  if (i.phase === "planning" || !i.task) return own(models.planner);
  const roleId = i.roleId ?? i.task.role;
  const roleModel = i.plan?.roles.find((r) => r.id === roleId)?.model;
  if (roleModel) return own(roleModel);
  if (!auto) return own(models.roles);
  const lift = i.plan && isHighLeverage(i.plan, i.task) ? 1 : 0;
  return stepUp(own(models.roles), lift + Math.max(0, i.escalations ?? 0), provider);
}

/** How many earlier runs of a task struggled: each one is a tier up under Automatic. */
export function taskEscalations(q: Pick<SquadState, "tasks">, taskId: string): number {
  return q.tasks[taskId]?.struggled?.length ?? 0;
}

/**
 * The model a task's next run uses (its current one while it runs), from the projection:
 * the role doing it now, its provider, and the runs that struggled so far. Undefined for an
 * unknown task.
 */
export function squadTaskModel(
  q: Pick<SquadState, "models" | "tasks"> & { providers?: SquadProviderChoice },
  plan: SquadPlan,
  taskId: string,
): string | undefined {
  const task = plan.tasks.find((t) => t.id === taskId);
  if (!task) return undefined;
  const roleId = q.tasks[taskId]?.role ?? task.role;
  return pickModel({
    models: q.models,
    provider: roleProviderOf(
      q.providers,
      plan.roles.find((r) => r.id === roleId),
    ),
    phase: "task",
    plan,
    task,
    roleId,
    escalations: taskEscalations(q, taskId),
  });
}
