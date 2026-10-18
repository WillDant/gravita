import { z } from "zod";
import {
  AGENT_PROVIDERS,
  CLAUDE_MODES,
  CODEX_MODES,
  CURSOR_MODES,
  USAGE_ACCOUNTS,
  USAGE_WINDOWS,
} from "./constants";
import {
  BudgetScope,
  BudgetUnit,
  DeliverMode,
  PlanTask,
  PlanWindowSchema,
  SquadAutonomy,
  SquadBudget,
  SquadModels,
  SquadPhase,
  SquadPlan,
  SquadProviders,
  TaskStatus,
} from "./squad";

// GravitaEvent: the one normalized event model. Every adapter (Claude SDK stream,
// Claude transcripts, hooks, later Codex) maps into this union. Projections and the
// UI only ever read these events.

export const EventSource = z.enum([
  "sdk",
  "transcript",
  "registry",
  "hook",
  "gravita",
  "codex-rpc",
  "codex-rollout",
  "cursor-acp",
  "cursor-transcript",
  "fake",
]);
export type EventSource = z.infer<typeof EventSource>;

export const ProviderSchema = z.enum(["claude", "codex", "cursor", "gravita", "fake"]);

/** The providers whose agents Gravita runs and detects (a subset of `ProviderSchema`). */
export const AgentProviderSchema = z.enum(AGENT_PROVIDERS);
export type AgentProvider = z.infer<typeof AgentProviderSchema>;

export const ToolKind = z.enum([
  "read",
  "search",
  "edit",
  "write",
  "bash",
  "web",
  "agent",
  "mcp",
  "todo",
  "ask",
  "plan",
  "other",
]);
export type ToolKind = z.infer<typeof ToolKind>;

export const SessionKind = z.enum(["chat", "squad", "external"]);
export type SessionKind = z.infer<typeof SessionKind>;

/** Pointer to the full content in its original file; we store previews, never copies. */
export const OutputRef = z.object({ path: z.string(), uuid: z.string() });

const envelope = {
  /** Unique idempotency key; see ids.ts `keys`. */
  key: z.string(),
  /** Source timestamp (ISO 8601). */
  ts: z.string(),
  source: EventSource,
  provider: ProviderSchema,
  projectId: z.string(),
  sessionId: z.string().optional(),
  /** Agent within the session: "main" or the provider's agent id. */
  agentId: z.string().optional(),
};

const ev = <T extends string, S extends z.ZodRawShape>(type: T, data: S) =>
  z.object({ ...envelope, type: z.literal(type), data: z.object(data) });

export const ProjectDiscovered = ev("project.discovered", {
  root: z.string(),
  name: z.string(),
  remote: z.string().optional(),
});

export const SessionStarted = ev("session.started", {
  kind: SessionKind,
  cwd: z.string(),
  gitBranch: z.string().optional(),
  model: z.string().optional(),
  permissionMode: z.string().optional(),
  entrypoint: z.string().optional(),
  cliVersion: z.string().optional(),
  authSourceKind: z.string().optional(),
  resumedFrom: z.string().optional(),
  /** Set on a squad role's session: which squad, role and task it works for. */
  squadId: z.string().optional(),
  roleId: z.string().optional(),
  taskId: z.string().optional(),
});

export const SessionTitled = ev("session.titled", { title: z.string() });

export const SessionPresence = ev("session.presence", {
  pid: z.number().optional(),
  status: z.enum(["busy", "idle", "waiting"]),
});

export const SessionDetached = ev("session.detached", { reason: z.string() });
export const SessionEnded = ev("session.ended", { reason: z.string() });
export const SessionRemoved = ev("session.removed", { reason: z.literal("user") });

/** Whether Gravita runs this session and can answer, interrupt or message it. Ephemeral. */
export const SessionControl = ev("session.control", { controllable: z.boolean() });

export const TurnCompleted = ev("turn.completed", {
  subtype: z.string().optional(),
  costUsd: z.number().optional(),
  durationMs: z.number().optional(),
  numTurns: z.number().optional(),
});

export const AgentSpawned = ev("agent.spawned", {
  parentAgentId: z.string(),
  spawnToolUseId: z.string().optional(),
  agentType: z.string(),
  description: z.string().optional(),
  depth: z.number().int().nonnegative(),
  background: z.boolean(),
  model: z.string().optional(),
});

export const AgentProgress = ev("agent.progress", {
  summary: z.string().optional(),
  lastToolName: z.string().optional(),
  totalTokens: z.number().optional(),
  toolUses: z.number().optional(),
});

export const AgentLifecycleStatus = z.enum([
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "killed",
]);

export const AgentLifecycle = ev("agent.lifecycle", {
  status: AgentLifecycleStatus,
  /**
   * The agent took up new work after it had finished (a Codex subagent sent a follow-up):
   * it is running again, unlike a late `running` report about work already done.
   */
  resumed: z.boolean().optional(),
});

export const AgentCompleted = ev("agent.completed", {
  status: z.enum(["completed", "failed", "killed", "stopped"]),
  summary: z.string().optional(),
  totalTokens: z.number().optional(),
  toolUseCount: z.number().optional(),
  durationMs: z.number().optional(),
});

export const MessageUser = ev("message.user", {
  uuid: z.string(),
  textPreview: z.string(),
  origin: z.enum(["human", "gravita", "handoff", "task-notification", "meta"]),
});

export const MessageAssistant = ev("message.assistant", {
  messageId: z.string(),
  textPreview: z.string(),
  model: z.string().optional(),
});

export const Thinking = ev("thinking", { messageId: z.string() });

export const ToolStarted = ev("tool.started", {
  toolUseId: z.string(),
  name: z.string(),
  kind: ToolKind,
  target: z.object({
    path: z.string().optional(),
    cmd: z.string().optional(),
    url: z.string().optional(),
    query: z.string().optional(),
    agentType: z.string().optional(),
  }),
  inputPreview: z.string(),
});

export const FileChange = z.object({
  path: z.string(),
  added: z.number().optional(),
  removed: z.number().optional(),
});

export const ToolCompleted = ev("tool.completed", {
  toolUseId: z.string(),
  ok: z.boolean(),
  outputPreview: z.string().optional(),
  outputRef: OutputRef.optional(),
  error: z.string().optional(),
  fileChanges: z.array(FileChange).optional(),
});

export const TodoUpdated = ev("todo.updated", {
  items: z.array(z.object({ content: z.string(), status: z.string() })),
});

export const CompactHappened = ev("compact.happened", {
  trigger: z.string().optional(),
  preTokens: z.number().optional(),
});

export const UsageReported = ev("usage.reported", {
  messageId: z.string(),
  model: z.string().optional(),
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  /** The model's context window, when the provider says (Codex does; Claude's transcripts don't). */
  contextWindow: z.number().int().positive().optional(),
});

export const UsageWindowSchema = z.enum(USAGE_WINDOWS);

/**
 * How much of a plan window the account has used, as its provider reports it (Claude's rate
 * limit events and usage reads, Codex's rate limits). Account-wide: every use of the same
 * account moves it, not only Gravita's. Ephemeral: the projection keeps the latest per
 * provider, account and window. It carries no session; `projectId` is the reporting
 * session's, or "".
 */
export const UsageLimits = ev("usage.limits", {
  provider: AgentProviderSchema,
  /**
   * Whose plan it is: absent for the user's own account, `squadProfile` for Gravita's own
   * Codex profile that Codex squads run in (possibly another ChatGPT account).
   */
  account: z.enum(USAGE_ACCOUNTS).optional(),
  window: UsageWindowSchema,
  /** For `seven_day_model` (and `other` when the provider names one): the model family. */
  model: z.string().optional(),
  /** 0–100. */
  usedPercent: z.number().min(0).max(100),
  /** When the window resets (ISO 8601). */
  resetsAt: z.string().optional(),
  planType: z.string().optional(),
  /** The provider's own reading: still allowed, close to the limit, or over it. */
  status: z.enum(["allowed", "warning", "rejected"]).optional(),
});

export const CostSnapshot = ev("cost.snapshot", {
  totalCostUsd: z.number(),
  linesAdded: z.number().optional(),
  linesRemoved: z.number().optional(),
});

export const PermissionRequested = ev("permission.requested", {
  requestId: z.string(),
  toolUseId: z.string().optional(),
  toolName: z.string(),
  inputPreview: z.string(),
});

export const PermissionResolved = ev("permission.resolved", {
  requestId: z.string(),
  decision: z.enum(["allow", "deny"]),
  by: z.enum(["user", "policy", "hook", "timeout"]),
});

export const Notification = ev("notification", {
  kind: z.string(),
  message: z.string().optional(),
});

/** Claude Code's permission modes. */
export const PermissionModeSchema = z.enum(CLAUDE_MODES);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

/** Codex's session modes (core's `session-modes` maps them to Claude's and back). */
export const CodexModeSchema = z.enum(CODEX_MODES);
export type CodexMode = z.infer<typeof CodexModeSchema>;

/** Cursor's session modes (core's `session-modes` maps them to Claude's and back). */
export const CursorModeSchema = z.enum(CURSOR_MODES);
export type CursorMode = z.infer<typeof CursorModeSchema>;

/** A session's mode in its own provider's terms; the engine checks it fits the provider. */
export const SessionModeSchema = z.union([PermissionModeSchema, CodexModeSchema, CursorModeSchema]);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/** Model and permission mode a Gravita-run session uses now. */
export const SessionSettings = ev("session.settings", {
  model: z.string().optional(),
  permissionMode: PermissionModeSchema.optional(),
  /**
   * The mode in the provider's own terms, set only when Claude Code's can't tell it apart
   * (Cursor's `ask` reads as `plan` there).
   */
  providerMode: SessionModeSchema.optional(),
});

export const QuestionOption = z.object({ label: z.string(), description: z.string().optional() });
export const Question = z.object({
  question: z.string(),
  header: z.string().optional(),
  multiSelect: z.boolean(),
  options: z.array(QuestionOption),
});
export type Question = z.infer<typeof Question>;

/** An agent asks the user to choose (AskUserQuestion). */
export const QuestionAsked = ev("question.asked", {
  requestId: z.string(),
  toolUseId: z.string().optional(),
  questions: z.array(Question),
});

export const QuestionAnswered = ev("question.answered", {
  requestId: z.string(),
  by: z.enum(["user", "timeout"]),
});

export const ErrorEvent = ev("error", {
  kind: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

// Squad events. They belong to a squad, not a session: `squadId` is in the data and the
// envelope's sessionId stays empty. Only the engine emits them.

const squadEv = <T extends string, S extends z.ZodRawShape>(type: T, data: S) =>
  ev(type, { squadId: z.string(), ...data });

export const SquadCreated = squadEv("squad.created", {
  cwd: z.string(),
  brief: z.string(),
  models: SquadModels,
  /** The budget in dollars: squads made before plan budgets, and USD squads still. */
  budgetUsd: z.number().positive().optional(),
  /** A share of the plan; a USD squad records `budgetUsd` instead (older readers know it). */
  budget: SquadBudget.optional(),
  autonomy: SquadAutonomy,
  /** The branch the squad started from, and later delivers into. */
  baseBranch: z.string().optional(),
  /** Who builds it; Claude Code only when absent (squads made before Codex roles). */
  providers: SquadProviders.optional(),
});

export const SquadPhaseChanged = squadEv("squad.phase_changed", {
  phase: SquadPhase,
  reason: z.string().optional(),
});

export const PlanProposed = squadEv("plan.proposed", {
  attempt: z.number().int().positive(),
  plan: SquadPlan,
});

export const PlanRejected = squadEv("plan.rejected", {
  attempt: z.number().int().positive(),
  errors: z.array(z.string()),
});

/** The user changed the proposed plan on the Board (each edit is a new revision). */
export const PlanEdited = squadEv("plan.edited", {
  revision: z.number().int().positive(),
  plan: SquadPlan,
});

export const PlanApproved = squadEv("plan.approved", {
  plan: SquadPlan,
  /** The user's answers to the plan's open questions, keyed by the question text. */
  answers: z.record(z.string(), z.string()).optional(),
});

export const TaskStatusChanged = squadEv("task.status_changed", {
  taskId: z.string(),
  status: TaskStatus,
  /** 1 on the first run; grows when a task is sent back or retried. */
  attempt: z.number().int().positive(),
  /** The role now doing it (reassignment moves it). */
  role: z.string(),
  sessionId: z.string().optional(),
  reason: z.string().optional(),
  /**
   * The attempt that just went wrong in a way a stronger model may fix (a failure, a
   * violation that ended it, a merge conflict or revert, a red check). Under the Automatic
   * model policy each one moves the task's later runs up a tier. On a "ready" status it is
   * the previous attempt; on "failed" or "blocked" this one.
   */
  struggledAttempt: z.number().int().positive().optional(),
});

export const NotePosted = squadEv("note.posted", {
  noteId: z.string(),
  fromRole: z.string(),
  toRole: z.string().optional(),
  text: z.string(),
});

export const ChangeRequestOpened = squadEv("change_request.opened", {
  requestId: z.string(),
  fromRole: z.string(),
  toRole: z.string(),
  text: z.string(),
  /** The task created for the receiving role, if any. */
  taskId: z.string().optional(),
});

export const ChangeRequestResolved = squadEv("change_request.resolved", {
  requestId: z.string(),
  outcome: z.enum(["done", "declined"]),
});

export const ContractFrozen = squadEv("contract.frozen", {
  path: z.string(),
  version: z.number().int().positive(),
  sha: z.string(),
});

export const CommitCreated = squadEv("commit.created", {
  role: z.string(),
  taskId: z.string(),
  sha: z.string(),
  files: z.array(z.string()),
});

/** The commit gate found changes outside the role's paths; the task goes back. */
export const OwnershipViolation = squadEv("ownership.violation", {
  role: z.string(),
  taskId: z.string(),
  attempt: z.number().int().positive(),
  paths: z.array(z.string()),
  /** Which try within the attempt (the role may fix and call complete_task again); 1 when absent. */
  bounce: z.number().int().positive().optional(),
});

const MergeRef = { taskId: z.string(), role: z.string(), attempt: z.number().int().positive() };
export const MergeStarted = squadEv("merge.started", MergeRef);
export const MergeSucceeded = squadEv("merge.succeeded", { ...MergeRef, sha: z.string() });
export const MergeConflicted = squadEv("merge.conflicted", {
  ...MergeRef,
  paths: z.array(z.string()),
});
/** A red integration check undid the merge; the task goes back to its role. */
export const MergeReverted = squadEv("merge.reverted", {
  ...MergeRef,
  toSha: z.string(),
  checkId: z.string(),
});

export const CheckRan = squadEv("check.ran", {
  checkId: z.string(),
  runId: z.string(),
  ok: z.boolean(),
  durationMs: z.number().optional(),
  outputPreview: z.string().optional(),
});

const BudgetLevel = {
  scope: BudgetScope,
  /** The task id or role id for task and role scopes; the squad id otherwise. */
  scopeId: z.string(),
  /** Absent (and dollars) on USD levels, as before plan budgets; `points` on a plan share. */
  unit: BudgetUnit.optional(),
  /** Dollars, on USD levels. */
  usedUsd: z.number().nonnegative().optional(),
  limitUsd: z.number().positive().optional(),
  /** Percentage points of `window` the squad used, and its share, on plan levels. */
  used: z.number().nonnegative().optional(),
  limit: z.number().positive().optional(),
  window: PlanWindowSchema.optional(),
  /** The provider whose window counted most (plan levels). */
  provider: AgentProviderSchema.optional(),
};
/** 75% of a budget is spent. */
export const BudgetWarned = squadEv("budget.warned", BudgetLevel);
/** A budget ran out: everything under it is interrupted and the squad waits for the user. */
export const BudgetExhausted = squadEv("budget.exhausted", BudgetLevel);
/**
 * The user raised the squad's budget (and maybe some roles'): the new limits apply, and the
 * 75% / 100% levels of the changed scopes are armed again. A USD squad changes dollars, a
 * plan squad its share of the window.
 */
export const SquadBudgetChanged = squadEv("squad.budget_changed", {
  budgetUsd: z.number().positive().optional(),
  previousUsd: z.number().nonnegative().optional(),
  maxPercent: z.number().min(1).max(100).optional(),
  previousPercent: z.number().nonnegative().optional(),
  /** New budgets of some roles, by role id. */
  roleBudgets: z.record(z.string(), z.number().positive()).optional(),
});

/**
 * Where a plan squad's count of one provider's window starts: its usage when the squad
 * started building (round 1), and again after the window reset mid-squad (round 2…), with
 * what the squad had used before the reset carried over. Usage samples are ephemeral, so
 * these are what a restarted engine counts from.
 */
export const BudgetBaseline = squadEv("budget.baseline", {
  provider: AgentProviderSchema,
  window: PlanWindowSchema,
  round: z.number().int().positive(),
  /** The window's usage the squad's count starts from (0 after a reset). */
  baseline: z.number().min(0).max(100),
  /** Points the squad used in earlier windows. */
  carried: z.number().nonnegative(),
  /** The window's usage when this was recorded. */
  current: z.number().min(0).max(100),
  resetsAt: z.string().optional(),
});

/**
 * The highest usage a plan squad's count of one provider's window reached in a round: noted
 * as it rises (every point or so), when the squad warns or runs out, and when it pauses.
 * Usage samples are ephemeral, so this is how a restarted engine knows what the squad used.
 */
export const BudgetMeasured = squadEv("budget.measured", {
  provider: AgentProviderSchema,
  window: PlanWindowSchema,
  round: z.number().int().positive(),
  /** The highest usage of the window seen in this round (0–100). */
  last: z.number().min(0).max(100),
});

/** The squad stopped starting work and its sessions were interrupted; it waits for the user. */
export const SquadPaused = squadEv("squad.paused", { reason: z.string() });
export const SquadResumed = squadEv("squad.resumed", {});

/**
 * A task that wasn't in the approved plan: a change request or a bug report from a role
 * (or from the final checks) became work for the role that owns the paths.
 */
export const TaskAdded = squadEv("task.added", {
  task: PlanTask,
  origin: z.enum(["change_request", "bug"]),
  /** The role that asked; absent when Gravita's final checks found the bug. */
  fromRole: z.string().optional(),
});

export const SquadDelivered = squadEv("squad.delivered", {
  mode: DeliverMode,
  /** The merged branch, the PR url, or the integration branch left for the user. */
  ref: z.string(),
});

export const GravitaEvent = z.discriminatedUnion("type", [
  ProjectDiscovered,
  SessionStarted,
  SessionTitled,
  SessionPresence,
  SessionDetached,
  SessionEnded,
  SessionRemoved,
  SessionControl,
  TurnCompleted,
  AgentSpawned,
  AgentProgress,
  AgentLifecycle,
  AgentCompleted,
  MessageUser,
  MessageAssistant,
  Thinking,
  ToolStarted,
  ToolCompleted,
  TodoUpdated,
  CompactHappened,
  UsageReported,
  UsageLimits,
  CostSnapshot,
  PermissionRequested,
  PermissionResolved,
  Notification,
  SessionSettings,
  QuestionAsked,
  QuestionAnswered,
  ErrorEvent,
  SquadCreated,
  SquadPhaseChanged,
  PlanProposed,
  PlanRejected,
  PlanEdited,
  PlanApproved,
  TaskStatusChanged,
  NotePosted,
  ChangeRequestOpened,
  ChangeRequestResolved,
  ContractFrozen,
  CommitCreated,
  OwnershipViolation,
  MergeStarted,
  MergeSucceeded,
  MergeConflicted,
  MergeReverted,
  CheckRan,
  BudgetWarned,
  BudgetExhausted,
  SquadBudgetChanged,
  BudgetBaseline,
  BudgetMeasured,
  SquadPaused,
  SquadResumed,
  TaskAdded,
  SquadDelivered,
]);

export type GravitaEvent = z.infer<typeof GravitaEvent>;
export type GravitaEventType = GravitaEvent["type"];
export type EventOf<T extends GravitaEventType> = Extract<GravitaEvent, { type: T }>;

/**
 * One plan usage window in Gravita's provider-neutral terms: what a `usage.limits` event
 * says, without the provider. Each provider's mapping produces these.
 */
export type PlanUsageLimit = Omit<EventOf<"usage.limits">["data"], "provider">;

/** An event after the store assigned its global ingest order. */
export type StoredEvent = GravitaEvent & { seq: number };

/**
 * Facts about the live moment (presence, control, plan usage). Applied and broadcast, never
 * stored.
 */
export const EPHEMERAL_EVENT_TYPES: ReadonlySet<GravitaEventType> = new Set([
  "session.presence",
  "session.detached",
  "session.control",
  "usage.limits",
]);
