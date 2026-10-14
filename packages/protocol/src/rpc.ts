import { z } from "zod";
import { AgentProviderSchema, GravitaEvent, SessionModeSchema } from "./events";
import { DeliverMode, SquadAutonomy, SquadModels, SquadPlan } from "./squad";

// JSON-RPC 2.0 over one WebSocket between the UI and the engine.
// Flow: connect → `auth` → `state.snapshot` → server pushes `events` batches.
// The UI applies events with the same reducer the engine uses (@gravita/core).

export {
  AGENT_PROVIDERS,
  CLAUDE_MODES,
  CODEX_MODES,
  DEFAULT_PROVIDER,
  Methods,
  Notifications,
  type ProviderErrorData,
  RPC_VERSION,
  RpcErrors,
} from "./constants";

export const AuthParams = z.object({ token: z.string(), rpcVersion: z.number() });
export const AuthResult = z.object({ ok: z.literal(true), engineVersion: z.string() });

/** `state.snapshot` returns `{ seq, state }`; `state` is a @gravita/core GravitaState. */
export const SnapshotParams = z.object({}).optional();

export const EventsNotification = z.object({
  /** Highest persisted seq included in this batch (ephemeral events don't advance it). */
  seq: z.number(),
  events: z.array(GravitaEvent),
});
export type EventsNotification = z.infer<typeof EventsNotification>;

/** What the engine knows about one provider's CLI on this machine. */
export const ProviderStatus = z.object({
  found: z.boolean(),
  path: z.string().optional(),
  version: z.string().optional(),
  /** True when the CLI is older than the minimum Gravita supports. */
  outdated: z.boolean().optional(),
  /** False after the CLI reported it isn't logged in; true after a successful turn. */
  loggedIn: z.boolean().optional(),
  /** The account it runs on, when the provider tells (never credentials). */
  account: z
    .object({ planType: z.string().optional(), authMode: z.string().optional() })
    .optional(),
});
export type ProviderStatus = z.infer<typeof ProviderStatus>;

/** @deprecated Claude Code's status is `ProviderStatus` under `EngineStatus.providers.claude`. */
export const ClaudeStatus = ProviderStatus;

export const EngineStatus = z.object({
  /** Each detected provider's CLI; a provider the engine doesn't look for is absent. */
  providers: z.object({ claude: ProviderStatus.optional(), codex: ProviderStatus.optional() }),
  /**
   * @deprecated Kept equal to `providers.claude` for one version, so an older UI still
   * knows whether Claude Code is there. Read `providers` instead.
   */
  claude: ProviderStatus,
  indexing: z.object({ done: z.number(), total: z.number() }),
  demo: z.boolean(),
});
export type EngineStatus = z.infer<typeof EngineStatus>;

/** `session.events` returns every stored event of one session, in seq order (for the line map). */
export const SessionEventsParams = z.object({ sessionId: z.string() });
export const SessionEventsResult = z.object({ events: z.array(GravitaEvent) });

/** `permission.respond` answers a pending permission request of a session Gravita controls. */
export const PermissionRespondParams = z.object({
  sessionId: z.string(),
  agentId: z.string(),
  requestId: z.string(),
  decision: z.enum(["allow", "deny"]),
});
export type PermissionRespondParams = z.infer<typeof PermissionRespondParams>;

export const OkResult = z.object({ ok: z.literal(true) });

const SessionRef = z.object({ sessionId: z.string() });

export const SessionStartParams = z.object({
  cwd: z.string().min(1),
  prompt: z.string().min(1).max(32_000),
  /** Which agent runs the session; Claude Code when absent. */
  provider: AgentProviderSchema.optional(),
  model: z.string().optional(),
  /** In the provider's own terms; the engine refuses a mode of another provider. */
  permissionMode: SessionModeSchema.optional(),
});
export const SessionStartResult = z.object({ sessionId: z.string(), projectId: z.string() });
export const SessionSendParams = SessionRef.extend({ text: z.string().min(1).max(32_000) });
export const AgentStopParams = SessionRef.extend({ agentId: z.string() });
export const SetModelParams = SessionRef.extend({ model: z.string().min(1) });
/** The mode is in the session's provider's terms; the engine refuses another provider's. */
export const SetPermissionModeParams = SessionRef.extend({ mode: SessionModeSchema });
export const QuestionAnswerParams = SessionRef.extend({
  agentId: z.string(),
  requestId: z.string(),
  /** Question text → chosen label(s); several labels are joined with ", ". */
  answers: z.record(z.string(), z.string()),
  /** Free-text reply instead of (or in addition to) the options. */
  response: z.string().max(8_000).optional(),
});
export type QuestionAnswerParams = z.infer<typeof QuestionAnswerParams>;

export const ConversationMessage = z.object({
  uuid: z.string(),
  role: z.enum(["user", "assistant"]),
  ts: z.string(),
  text: z.string(),
  /** Subagents started from this assistant message, for chips in the conversation. */
  spawned: z.array(z.object({ toolUseId: z.string(), agentType: z.string() })).optional(),
});
export type ConversationMessage = z.infer<typeof ConversationMessage>;
export const ConversationResult = z.object({ messages: z.array(ConversationMessage) });
/** The kill switch: every session Gravita runs is stopped (its Claude Code process ends). */
export const StopAllResult = z.object({ stopped: z.number().int().nonnegative() });

export const ModelsListParams = z.object({ provider: AgentProviderSchema });
export const ModelsResult = z.object({
  models: z.array(z.object({ value: z.string(), displayName: z.string() })),
});

// Squad control. The engine re-validates every plan it receives; the UI's validation
// (same @gravita/core rules) is only for live feedback on the Board.
export const SquadRef = z.object({ squadId: z.string() });
export const SquadCreateParams = z.object({
  cwd: z.string().min(1),
  brief: z.string().min(1).max(8_000),
  models: SquadModels.optional(),
  budgetUsd: z.number().positive().max(1_000),
  autonomy: SquadAutonomy,
});
export const SquadCreateResult = z.object({ squadId: z.string(), projectId: z.string() });
export const SquadReplanParams = SquadRef.extend({ feedback: z.string().min(1).max(4_000) });
export const SquadApproveParams = SquadRef.extend({
  plan: SquadPlan,
  /** Answers to the plan's open questions, keyed by the question text. */
  answers: z.record(z.string(), z.string()).optional(),
});
export const SquadTaskRef = SquadRef.extend({ taskId: z.string() });
export const SquadRetryParams = SquadTaskRef.extend({ model: z.string().optional() });
export const SquadReassignParams = SquadTaskRef.extend({ role: z.string() });
/**
 * Resuming may raise the budget (the new total, which the engine checks is above what was
 * spent) and the budget of some roles: how a squad that ran out goes on.
 */
export const SquadResumeParams = SquadRef.extend({
  budgetUsd: z.number().positive().max(1_000).optional(),
  roleBudgets: z.record(z.string(), z.number().positive().max(500)).optional(),
});
export const SquadDeliverParams = SquadRef.extend({ mode: DeliverMode });
export const SquadDeliverResult = z.object({ ref: z.string() });

/**
 * Every method's params and result, in one place. The engine's router validates with
 * these schemas; the UI derives its types from them (type-only, so no zod in the bundle).
 * `state` in the snapshot is a @gravita/core GravitaState (protocol stays below core).
 */
export const RpcContract = {
  auth: { params: AuthParams, result: AuthResult },
  "state.snapshot": {
    params: SnapshotParams,
    result: z.object({ seq: z.number(), state: z.unknown() }),
  },
  "engine.status": { params: z.object({}).optional(), result: EngineStatus },
  "session.events": { params: SessionEventsParams, result: SessionEventsResult },
  "permission.respond": { params: PermissionRespondParams, result: OkResult },
  "session.start": { params: SessionStartParams, result: SessionStartResult },
  "session.send": { params: SessionSendParams, result: OkResult },
  "session.interrupt": { params: SessionRef, result: OkResult },
  "agent.stop": { params: AgentStopParams, result: OkResult },
  "session.setModel": { params: SetModelParams, result: OkResult },
  "session.setPermissionMode": { params: SetPermissionModeParams, result: OkResult },
  "question.answer": { params: QuestionAnswerParams, result: OkResult },
  "session.conversation": { params: SessionRef, result: ConversationResult },
  /** The models a provider offers (asked of a live session, else its known aliases). */
  "models.list": { params: ModelsListParams, result: ModelsResult },
  /** @deprecated `models.list` with `{ provider: "claude" }`; kept for older clients. */
  "claude.models": { params: z.object({}).optional(), result: ModelsResult },
  "engine.stopAll": { params: z.object({}).optional(), result: StopAllResult },
  "squad.create": { params: SquadCreateParams, result: SquadCreateResult },
  /** Ends the brief conversation: the planner turns what it learned into a SquadPlan. */
  "squad.plan": { params: SquadRef, result: OkResult },
  "squad.replan": { params: SquadReplanParams, result: OkResult },
  "squad.approvePlan": { params: SquadApproveParams, result: OkResult },
  "squad.pause": { params: SquadRef, result: OkResult },
  "squad.resume": { params: SquadResumeParams, result: OkResult },
  "squad.stop": { params: SquadRef, result: OkResult },
  "squad.task.retry": { params: SquadRetryParams, result: OkResult },
  "squad.task.skip": { params: SquadTaskRef, result: OkResult },
  "squad.task.reassign": { params: SquadReassignParams, result: OkResult },
  "squad.deliver": { params: SquadDeliverParams, result: SquadDeliverResult },
} as const;

export type RpcMethod = keyof typeof RpcContract;
export type RpcParams<M extends RpcMethod> = z.input<(typeof RpcContract)[M]["params"]>;
export type RpcResult<M extends RpcMethod> = z.output<(typeof RpcContract)[M]["result"]>;

export interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  /** `data` says more where the error defines it (e.g. `ProviderErrorData`). */
  error?: { code: number; message: string; data?: unknown };
}

export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
}
