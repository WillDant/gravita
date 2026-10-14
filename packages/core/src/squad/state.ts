import type {
  AgentProvider,
  BudgetScope,
  DeliverMode,
  PlanTask,
  PlanWindow,
  SquadAutonomy,
  SquadModels,
  SquadPhase,
  SquadPlan,
  SquadProviders,
  TaskStatus,
} from "@gravita/protocol";

// The projection of one squad: everything the Board shows, rebuilt from squad events
// and the role sessions' cost snapshots.

export type PlanStatus = "none" | "proposed" | "edited" | "approved";

export interface SquadTaskState {
  status: TaskStatus;
  attempt: number;
  /** The role doing it now (a reassignment moves it). */
  role: string;
  sessionId?: string;
  reason?: string;
  /**
   * Earlier attempts that went wrong in a way a stronger model may fix, ascending; each one
   * moves the task up a model tier under the Automatic policy (see `taskEscalations`).
   */
  struggled?: number[];
  updatedTs: string;
}

export interface SquadRoleState {
  sessionIds: string[];
  /** The role's most recently started session. */
  currentSessionId?: string;
  /** Sum of the role sessions' cost. */
  spentUsd: number;
}

export interface SquadNote {
  noteId: string;
  fromRole: string;
  toRole?: string;
  text: string;
  ts: string;
}

export interface ChangeRequestState {
  requestId: string;
  fromRole: string;
  toRole: string;
  text: string;
  taskId?: string;
  state: "open" | "done" | "declined";
  openedTs?: string;
  resolvedTs?: string;
}

export interface ContractState {
  version: number;
  sha: string;
  ts: string;
}

export interface SquadCommit {
  sha: string;
  role: string;
  taskId: string;
  files: string[];
  ts: string;
}

export interface OwnershipViolationState {
  role: string;
  taskId: string;
  attempt: number;
  /** Which try within the attempt; 1 for the first. */
  bounce?: number;
  paths: string[];
  ts: string;
}

/** A task added after approval (a change request or a bug), and who asked for it. */
export interface AddedTask {
  task: PlanTask;
  origin: "change_request" | "bug";
  fromRole?: string;
  ts: string;
}

export type MergeState = "started" | "succeeded" | "conflicted" | "reverted";

export interface SquadMerge {
  taskId: string;
  role: string;
  attempt: number;
  state: MergeState;
  sha?: string;
  /** Conflicting paths, for a conflicted merge. */
  paths?: string[];
  /** For a reverted merge: where the branch went back to, and the check that failed. */
  toSha?: string;
  checkId?: string;
  ts: string;
}

export interface SquadCheckState {
  ok: boolean;
  runId: string;
  durationMs?: number;
  outputPreview?: string;
  ts: string;
}

/** `${scope}:${scopeId}`, e.g. "role:backend" or "squad:q1". */
export type BudgetKey = `${BudgetScope}:${string}`;

/**
 * A plan squad's count of one provider's window. Plan usage is account-wide, so the squad's
 * share is what the window moved since the squad started: `carried + (last - baseline)`.
 * A window that resets mid-squad carries what was used before it and counts again from 0.
 */
export interface PlanMeter {
  provider: AgentProvider;
  window: PlanWindow;
  /** The window's usage the count starts from (0 after a reset). */
  baseline: number;
  /** Points used in earlier windows (before a reset). */
  carried: number;
  /** The highest usage seen in the current window. */
  last: number;
  /** When the current window resets, as last reported. */
  resetsAt?: string;
  /** 1 from the start; one more per reset. */
  round: number;
  /** The highest round recorded as a `budget.baseline` fact (what a restart counts from). */
  savedRound: number;
}

export interface SquadSpend {
  /** API-equivalent dollars of the squad's sessions (the budget itself in USD mode). */
  spentUsd: number;
  warned: BudgetKey[];
  exhausted: BudgetKey[];
  /** Plan squads: the count of each provider's window, by `${provider}:${window}`. */
  meters?: Record<string, PlanMeter>;
}

export interface SquadState {
  id: string;
  projectId: string;
  /** False while only role sessions or later facts have been seen (a stub). */
  created: boolean;
  cwd: string;
  brief: string;
  models: SquadModels;
  /** The budget in dollars; 0 for a plan squad (see `budgetPlan` and `squadBudget`). */
  budgetUsd: number;
  /** Set when the budget is a share of a plan window instead of dollars. */
  budgetPlan?: { maxPercent: number; window: PlanWindow };
  autonomy: SquadAutonomy;
  /** Who builds it (the Brief's choice); absent: Claude Code only. */
  providers?: SquadProviders;
  baseBranch?: string;
  phase: SquadPhase;
  phaseReason?: string;
  phaseTs?: string;
  /** How many times each phase was entered (a squad can go back to build after verify). */
  phaseRounds: Partial<Record<SquadPhase, number>>;
  createdTs: string;
  lastEventTs: string;
  /** The latest proposed, edited or approved plan. */
  plan?: SquadPlan;
  planStatus: PlanStatus;
  /** Highest planner attempt seen (proposed or rejected). */
  planAttempts: number;
  /** Highest Board edit revision seen. */
  planRevision: number;
  /** Why the latest planner attempt was rejected; cleared by a newer proposal. */
  planErrors?: string[];
  planErrorsAttempt?: number;
  approvedTs?: string;
  /** The user's answers to the plan's questions, given at approval. */
  answers?: Record<string, string>;
  /** Tasks added after approval, in the order they came; see `squadTasks`. */
  addedTasks?: AddedTask[];
  /** Set while the squad waits for the user to resume it. */
  paused?: { reason: string; ts: string };
  /** Role budgets the user set after approval, over the plan's (see `roleBudget`). */
  roleBudgets?: Record<string, number>;
  /** How many times the budget was changed (event keys count them). */
  budgetChanges?: number;
  /** How many times the squad was paused and resumed (event keys count them). */
  pauseCount?: number;
  resumeCount?: number;
  tasks: Record<string, SquadTaskState>;
  roles: Record<string, SquadRoleState>;
  /** Every session that works for this squad, roles and planner alike. */
  sessionIds: string[];
  notes: SquadNote[];
  changeRequests: Record<string, ChangeRequestState>;
  /** Frozen contract files by path, at their highest version. */
  contracts: Record<string, ContractState>;
  commits: SquadCommit[];
  violations: OwnershipViolationState[];
  /** By `${taskId}:${attempt}`. */
  merges: Record<string, SquadMerge>;
  /** Latest run of each check. */
  checks: Record<string, SquadCheckState>;
  budget: SquadSpend;
  delivered?: { mode: DeliverMode; ref: string; ts: string };
}
