import { z } from "zod";
import { GravitaEvent } from "./events";

// JSON-RPC 2.0 over one WebSocket between the UI and the engine.
// Flow: connect → `auth` → `state.snapshot` → server pushes `events` batches.
// The UI applies events with the same reducer the engine uses (@gravita/core).

export { Methods, Notifications, RPC_VERSION, RpcErrors } from "./constants";

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

export const ClaudeStatus = z.object({
  found: z.boolean(),
  path: z.string().optional(),
  version: z.string().optional(),
  /** True when the CLI is older than the minimum Gravita supports. */
  outdated: z.boolean().optional(),
});

export const EngineStatus = z.object({
  claude: ClaudeStatus,
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
  error?: { code: number; message: string };
}

export interface RpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: unknown;
}
