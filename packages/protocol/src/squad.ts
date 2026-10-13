import { z } from "zod";
import { PLAN_WINDOWS } from "./constants";

// The Squad contract: a team of role agents, each in its own git worktree, working one
// validated plan. The planner proposes a SquadPlan, the user approves it on the Board,
// and the engine runs it. Shape checks live here; the rules that relate fields to each
// other (disjoint ownership, writes within owns, an acyclic task graph) live in
// @gravita/core's validatePlan, so the UI and the engine judge a plan the same way.

/** A repo-relative path or prefix: forward slashes, no leading "/", no "..". */
const RelPath = z.string().min(1).max(200);

export const RoleKind = z.enum(["planner", "backend", "frontend", "design", "tests", "custom"]);
export type RoleKind = z.infer<typeof RoleKind>;

export const TaskSize = z.enum(["s", "m", "l"]);
export type TaskSize = z.infer<typeof TaskSize>;

export const PlanRole = z.object({
  /** Short slug, also the branch suffix: gravita/<squad>/<id>. */
  id: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/),
  name: z.string().min(1).max(40),
  kind: RoleKind,
  /** Path prefixes this role alone may change ("apps/api/", "packages/ui/"). */
  owns: z.array(RelPath).min(1).max(12),
  /** A plain-language charter, appended to the role's system prompt. */
  charter: z.string().max(2_000),
  model: z.string().optional(),
  budgetUsd: z.number().positive().max(500).optional(),
});
export type PlanRole = z.infer<typeof PlanRole>;

export const PlanContract = z.object({
  /** Shared interface file (OpenAPI, types, design tokens), frozen at v1 after the foundation. */
  path: RelPath,
  owner: z.string(),
  kind: z.enum(["openapi", "types", "tokens", "schema", "other"]),
  description: z.string().max(400).optional(),
});
export type PlanContract = z.infer<typeof PlanContract>;

export const PlanTask = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  role: z.string(),
  title: z.string().min(1).max(80),
  /** What it achieves, for someone who doesn't read code. */
  plainSummary: z.string().min(1).max(280),
  dependsOn: z.array(z.string()).max(12),
  /** Paths it will change; each must sit inside its role's `owns`. */
  writes: z.array(RelPath).min(1).max(24),
  acceptance: z.array(z.string().max(200)).min(1).max(8),
  size: TaskSize,
  /** Foundation tasks (scaffold, contracts) run before any build task. */
  foundation: z.boolean().optional(),
});
export type PlanTask = z.infer<typeof PlanTask>;

export const PlanCheck = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  /** Program and arguments, run without a shell. Shown to the user before approval. */
  argv: z.array(z.string().min(1).max(200)).min(1).max(16),
  /** Repo-relative working directory; "." for the root. */
  cwd: RelPath,
  when: z.enum(["task", "integration", "final"]),
  description: z.string().max(200).optional(),
});
export type PlanCheck = z.infer<typeof PlanCheck>;

export const SquadPlan = z.object({
  goal: z.string().min(1).max(500),
  summary: z.string().min(1).max(1_500),
  stack: z.array(z.string().max(60)).max(12),
  roles: z.array(PlanRole).min(1).max(6),
  /** Files Gravita owns and regenerates on the integration branch (lockfiles, root manifest, CI). */
  shared: z.object({
    paths: z.array(RelPath).max(24),
    strategy: z.literal("regenerate"),
  }),
  contracts: z.array(PlanContract).max(12),
  tasks: z.array(PlanTask).min(1).max(40),
  checks: z.array(PlanCheck).max(12),
  assumptions: z.array(z.string().max(300)).max(12),
  /** Open questions for the user, answered on the Board before approval. */
  questions: z.array(z.string().max(300)).max(8),
});
export type SquadPlan = z.infer<typeof SquadPlan>;

/** The plan as JSON Schema draft-07, for the planner's structured output. */
export function squadPlanJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SquadPlan, { target: "draft-7" }) as Record<string, unknown>;
}

export const SquadPhase = z.enum([
  "brief",
  "planning",
  "review",
  "foundation",
  "build",
  "verify",
  "deliver",
  "done",
  "failed",
  "stopped",
]);
export type SquadPhase = z.infer<typeof SquadPhase>;

export const TaskStatus = z.enum([
  "pending",
  "ready",
  "running",
  "blocked",
  "review",
  "done",
  "failed",
  "skipped",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/**
 * How much the squad may do without asking: `ask` sends every permission to the user,
 * `guarded` asks only for network and installs, `auto` asks for nothing beyond the plan.
 */
export const SquadAutonomy = z.enum(["ask", "guarded", "auto"]);
export type SquadAutonomy = z.infer<typeof SquadAutonomy>;

/**
 * How a squad picks its models. `auto` is Gravita's cost-benefit policy (core's pickModel):
 * a cheaper model where the work is routine, the strongest where a mistake costs most.
 * `fixed` runs one model per job, as the user picked it.
 */
export const SquadModelMode = z.enum(["auto", "fixed"]);
export type SquadModelMode = z.infer<typeof SquadModelMode>;

/**
 * Which models a squad runs. Under `mode: "auto"` the briefing runs on `briefing`, the
 * planning run on `planner`, everyday tasks on `roles`, and high-leverage or struggling
 * tasks a tier up. Under `fixed` (or no mode: squads made before the policy) the briefing
 * and planning run on `planner` and every task on `roles`. A plan role's own `model` wins
 * over both.
 */
export const SquadModels = z.object({
  planner: z.string(),
  roles: z.string(),
  /** The briefing conversation's model; `planner` when absent. */
  briefing: z.string().optional(),
  mode: SquadModelMode.optional(),
});
export type SquadModels = z.infer<typeof SquadModels>;

export const BudgetScope = z.enum(["task", "role", "squad"]);
export type BudgetScope = z.infer<typeof BudgetScope>;

/** A plan window a squad's budget can be a share of: the 5-hour window or the weekly limit. */
export const PlanWindowSchema = z.enum(PLAN_WINDOWS);

/**
 * What a squad may use. Most people run on a subscription with usage limits, so the budget
 * is a share of a plan window: `maxPercent` percentage points of it, counted from when the
 * squad starts building. Accounts without plan limits (an API key) pay per token, so their
 * budget is in dollars.
 */
export const SquadBudget = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("plan"),
    maxPercent: z.number().min(1).max(100),
    window: PlanWindowSchema,
  }),
  z.object({ mode: z.literal("usd"), amount: z.number().positive().max(1_000) }),
]);
export type SquadBudget = z.infer<typeof SquadBudget>;

/** What a budget level is counted in: dollars, or percentage points of a plan window. */
export const BudgetUnit = z.enum(["usd", "points"]);
export type BudgetUnit = z.infer<typeof BudgetUnit>;

export const DeliverMode = z.enum(["merge", "pr", "branch"]);
export type DeliverMode = z.infer<typeof DeliverMode>;
