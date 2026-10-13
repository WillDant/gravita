import type {
  BudgetScope,
  DeliverMode,
  SquadAutonomy,
  SquadModels,
  SquadPhase,
  SquadPlan,
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
  paths: string[];
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

export interface SquadBudget {
  spentUsd: number;
  warned: BudgetKey[];
  exhausted: BudgetKey[];
}

export interface SquadState {
  id: string;
  projectId: string;
  /** False while only role sessions or later facts have been seen (a stub). */
  created: boolean;
  cwd: string;
  brief: string;
  models: SquadModels;
  budgetUsd: number;
  autonomy: SquadAutonomy;
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
  budget: SquadBudget;
  delivered?: { mode: DeliverMode; ref: string; ts: string };
}
