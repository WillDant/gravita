// Deterministic ids and idempotency keys. Every source (SDK stream, transcript tailer,
// hooks) must derive the same id for the same thing, across restarts. Never random.

export type Provider = "claude" | "codex" | "cursor" | "gravita" | "fake";

/** Id of the main agent of a session. */
export const MAIN_AGENT = "main";

export function sessionNodeId(provider: Provider, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

export function agentNodeId(provider: Provider, sessionId: string, agentId: string): string {
  return `${provider}:${sessionId}:${agentId}`;
}

export function toolNodeId(provider: Provider, toolUseId: string): string {
  return `${provider}:${toolUseId}`;
}

/** Idempotency keys. Same fact from any source → same key → stored once. */
export const keys = {
  sessionStarted: (sid: string) => `session:${sid}:started`,
  sessionEnded: (sid: string) => `session:${sid}:ended`,
  sessionRemoved: (sid: string) => `session:${sid}:removed`,
  agentSpawned: (sid: string, agentId: string) => `agent:${sid}:${agentId}:spawned`,
  agentCompleted: (sid: string, agentId: string) => `agent:${sid}:${agentId}:completed`,
  agentLifecycle: (sid: string, agentId: string, status: string) =>
    `agent:${sid}:${agentId}:lifecycle:${status}`,
  toolStarted: (toolUseId: string) => `tool:${toolUseId}:started`,
  toolCompleted: (toolUseId: string) => `tool:${toolUseId}:completed`,
  assistantBlock: (messageId: string, blockKind: string, discriminator: string) =>
    `msg:${messageId}:${blockKind}:${discriminator}`,
  userMessage: (uuid: string) => `user:${uuid}`,
  usage: (messageId: string) => `usage:${messageId}`,
  turnCompleted: (sid: string, uuid: string) => `turn:${sid}:${uuid}`,
  permissionRequested: (requestId: string) => `perm:${requestId}:requested`,
  permissionResolved: (requestId: string) => `perm:${requestId}:resolved`,
  questionAsked: (requestId: string) => `question:${requestId}:asked`,
  questionAnswered: (requestId: string) => `question:${requestId}:answered`,
  sessionSettings: (sid: string, seq: number) => `settings:${sid}:${seq}`,
  // Squad facts. Keys name the fact and its attempt, so replaying a squad after a crash
  // re-emits the same keys and stores nothing twice.
  squadCreated: (sq: string) => `squad:${sq}:created`,
  squadPhase: (sq: string, phase: string, round: number) => `squad:${sq}:phase:${phase}:${round}`,
  planProposed: (sq: string, attempt: number) => `squad:${sq}:plan:proposed:${attempt}`,
  planRejected: (sq: string, attempt: number) => `squad:${sq}:plan:rejected:${attempt}`,
  planEdited: (sq: string, revision: number) => `squad:${sq}:plan:edited:${revision}`,
  planApproved: (sq: string) => `squad:${sq}:plan:approved`,
  taskStatus: (sq: string, taskId: string, attempt: number, status: string) =>
    `squad:${sq}:task:${taskId}:${attempt}:${status}`,
  note: (sq: string, noteId: string) => `squad:${sq}:note:${noteId}`,
  changeRequest: (sq: string, requestId: string, state: "opened" | "resolved") =>
    `squad:${sq}:cr:${requestId}:${state}`,
  contractFrozen: (sq: string, path: string, version: number) =>
    `squad:${sq}:contract:${path}:${version}`,
  commit: (sq: string, sha: string) => `squad:${sq}:commit:${sha}`,
  ownershipViolation: (sq: string, taskId: string, attempt: number, bounce = 1) =>
    `squad:${sq}:violation:${taskId}:${attempt}${bounce > 1 ? `:${bounce}` : ""}`,
  merge: (sq: string, taskId: string, attempt: number, state: string) =>
    `squad:${sq}:merge:${taskId}:${attempt}:${state}`,
  checkRan: (sq: string, checkId: string, runId: string) => `squad:${sq}:check:${checkId}:${runId}`,
  budget: (sq: string, scope: string, scopeId: string, level: "warned" | "exhausted") =>
    `squad:${sq}:budget:${scope}:${scopeId}:${level}`,
  squadDelivered: (sq: string) => `squad:${sq}:delivered`,
  /** The n-th pause (and resume) of a squad. */
  squadPaused: (sq: string, n: number) => `squad:${sq}:paused:${n}`,
  squadResumed: (sq: string, n: number) => `squad:${sq}:resumed:${n}`,
  /** Where a plan squad's count of a provider's window starts, per round (resets add one). */
  budgetBaseline: (sq: string, provider: string, window: string, round: number) =>
    `squad:${sq}:baseline:${provider}:${window}:${round}`,
  /** The highest usage a plan squad's count of a window reached in a round, as noted. */
  budgetMeasured: (sq: string, provider: string, window: string, round: number, last: number) =>
    `squad:${sq}:measured:${provider}:${window}:${round}:${last}`,
  /** A plan usage reading (ephemeral, never stored; keyed like a fact all the same). */
  usageLimits: (provider: string, window: string, model: string | undefined, tag: string) =>
    `usage:${provider}:${window}${model ? `:${model}` : ""}:${tag}`,
  /** The n-th budget change of a squad. */
  budgetChanged: (sq: string, n: number) => `squad:${sq}:budget-changed:${n}`,
  taskAdded: (sq: string, taskId: string) => `squad:${sq}:task:${taskId}:added`,
  /** A role's n-th report_progress within one attempt of a task. */
  roleProgress: (sq: string, taskId: string, attempt: number, n: number) =>
    `squad:${sq}:progress:${taskId}:${attempt}:${n}`,
} as const;
