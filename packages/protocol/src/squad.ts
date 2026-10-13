import { z } from "zod";

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

export const SquadModels = z.object({ planner: z.string(), roles: z.string() });
export type SquadModels = z.infer<typeof SquadModels>;

export const BudgetScope = z.enum(["task", "role", "squad"]);
export type BudgetScope = z.infer<typeof BudgetScope>;

export const DeliverMode = z.enum(["merge", "pr", "branch"]);
export type DeliverMode = z.infer<typeof DeliverMode>;
