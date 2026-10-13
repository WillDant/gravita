import { z } from "zod";

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
  "fake",
]);
export type EventSource = z.infer<typeof EventSource>;

export const ProviderSchema = z.enum(["claude", "codex", "gravita", "fake"]);

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
});

export const SessionTitled = ev("session.titled", { title: z.string() });

export const SessionPresence = ev("session.presence", {
  pid: z.number().optional(),
  status: z.enum(["busy", "idle", "waiting"]),
});

export const SessionDetached = ev("session.detached", { reason: z.string() });
export const SessionEnded = ev("session.ended", { reason: z.string() });

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

export const AgentLifecycle = ev("agent.lifecycle", { status: AgentLifecycleStatus });

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

export const ErrorEvent = ev("error", {
  kind: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export const GravitaEvent = z.discriminatedUnion("type", [
  ProjectDiscovered,
  SessionStarted,
  SessionTitled,
  SessionPresence,
  SessionDetached,
  SessionEnded,
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
  CostSnapshot,
  PermissionRequested,
  PermissionResolved,
  Notification,
  ErrorEvent,
]);

export type GravitaEvent = z.infer<typeof GravitaEvent>;
export type GravitaEventType = GravitaEvent["type"];
export type EventOf<T extends GravitaEventType> = Extract<GravitaEvent, { type: T }>;

/** An event after the store assigned its global ingest order. */
export type StoredEvent = GravitaEvent & { seq: number };
