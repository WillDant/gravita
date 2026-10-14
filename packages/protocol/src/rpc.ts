import { z } from "zod";
import { ACCOUNT_PLANS } from "./constants";
import { AgentProviderSchema, GravitaEvent, SessionModeSchema } from "./events";
import {
  DeliverMode,
  SquadAutonomy,
  SquadBudget,
  SquadModels,
  SquadPlan,
  SquadProviders,
} from "./squad";

// JSON-RPC 2.0 over one WebSocket between the UI and the engine.
// Flow: connect → `auth` → `state.snapshot` → server pushes `events` batches.
// The UI applies events with the same reducer the engine uses (@gravita/core).

export {
  ACCOUNT_PLANS,
  type AccountPlan,
  AGENT_PROVIDERS,
  CLAUDE_MODES,
  CODEX_MODES,
  DEFAULT_PROVIDER,
  Methods,
  Notifications,
  PLAN_WINDOWS,
  type PlanWindow,
  type ProviderErrorData,
  RPC_VERSION,
  RpcErrors,
  SQUAD_PROVIDER_CHOICES,
  type SquadProviderChoice,
  USAGE_WINDOWS,
  type UsageWindow,
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

/**
 * Gravita's own Codex profile, which squads run on: a clean Codex home under Gravita's data
 * folder that the user signs in to once (see docs/codex.md).
 */
export const CodexProfileStatus = z.object({
  loggedIn: z.boolean(),
  /** `chatgpt` or `apikey`; never the email or account id. */
  authMode: z.string().optional(),
  planType: z.string().optional(),
  /** A sign-in was started and its browser step isn't finished yet. */
  signingIn: z.boolean().optional(),
  /** Why the last sign-in failed. */
  error: z.string().optional(),
});
export type CodexProfileStatus = z.infer<typeof CodexProfileStatus>;

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
    .object({
      planType: z.string().optional(),
      authMode: z.string().optional(),
      /**
       * `limited`: plan usage limits apply (a subscription), so squad budgets are a share of
       * the plan; `api`: it pays per token (an API key), so budgets are dollars. Absent until
       * the provider tells.
       */
      plan: z.enum(ACCOUNT_PLANS).optional(),
    })
    .optional(),
  /** Codex only: Gravita's own Codex profile for squads. Absent until the engine looked. */
  squadProfile: CodexProfileStatus.optional(),
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
export const SquadCreateParams = z
  .object({
    cwd: z.string().min(1),
    brief: z.string().min(1).max(8_000),
    models: SquadModels.optional(),
    /** A share of the plan, or dollars for an account without plan limits. */
    budget: SquadBudget.optional(),
    /** The older form of a dollar budget: `{ mode: "usd", amount }`. */
    budgetUsd: z.number().positive().max(1_000).optional(),
    autonomy: SquadAutonomy,
    /** Who builds it: Claude Code only when absent. */
    providers: SquadProviders.optional(),
  })
  .refine((p) => p.budget !== undefined || p.budgetUsd !== undefined, {
    message: "A squad needs a budget",
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
 * spent) and the budget of some roles: how a squad that ran out goes on. A USD squad raises
 * `budgetUsd`; a plan squad its share, `maxPercent`.
 */
export const SquadResumeParams = SquadRef.extend({
  budgetUsd: z.number().positive().max(1_000).optional(),
  maxPercent: z.number().min(1).max(100).optional(),
  roleBudgets: z.record(z.string(), z.number().positive().max(500)).optional(),
});
export const SquadDeliverParams = SquadRef.extend({ mode: DeliverMode });
export const SquadDeliverResult = z.object({ ref: z.string() });

/**
 * Starts the profile's ChatGPT sign-in: the client opens `authUrl` in the browser, Codex
 * takes the callback and keeps the tokens in Gravita's Codex home; the end arrives as an
 * `engine.status` update.
 */
export const CodexProfileSignInResult = z.object({ authUrl: z.string().url() });

/**
 * Asks the engine to read plan usage again through a session that is already running (a
 * chat or a squad's). It never starts one, and reads at most every so often; the values
 * arrive as `usage.limits` events.
 */
export const UsageRefreshParams = z.object({ provider: AgentProviderSchema.optional() }).optional();

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
  "usage.refresh": { params: UsageRefreshParams, result: OkResult },
  /** Reads Gravita's Codex profile (a short-lived app-server; nothing spent). */
  "codexProfile.status": { params: z.object({}).optional(), result: CodexProfileStatus },
  "codexProfile.signIn": { params: z.object({}).optional(), result: CodexProfileSignInResult },
  "codexProfile.signOut": { params: z.object({}).optional(), result: OkResult },
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
