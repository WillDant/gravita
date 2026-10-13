import type { GravitaState } from "@gravita/core";
import type { EngineStatus, EventsNotification, RpcParams, RpcResult } from "@gravita/protocol";

/** Whether the link to the engine is up (authenticated) or down (retrying). */
export type GatewayConnection = "online" | "offline";

export type Unsubscribe = () => void;

/** `state.snapshot`, with `state` typed as the @gravita/core projection it carries. */
export type EngineSnapshot = Omit<RpcResult<"state.snapshot">, "state"> & { state: GravitaState };

/**
 * The UI's only port to the engine. The store and feature hooks depend on this
 * interface; the WebSocket transport (or a fake in tests) implements it. Calls reject
 * with a `GatewayError` that keeps the engine's JSON-RPC error code.
 */
export interface EngineGateway {
  /** Opens the link and keeps it open, reconnecting with backoff when it drops. */
  connect(): void;
  /** Closes the link for good (no reconnect). */
  close(): void;
  /** Drops the current link; it comes back by itself with backoff. */
  reconnect(): void;

  snapshot(): Promise<EngineSnapshot>;
  sessionEvents(params: RpcParams<"session.events">): Promise<RpcResult<"session.events">>;
  respondPermission(
    params: RpcParams<"permission.respond">,
  ): Promise<RpcResult<"permission.respond">>;

  // Driving sessions Gravita runs. Every call rejects with a GatewayError (code kept).
  startSession(params: RpcParams<"session.start">): Promise<RpcResult<"session.start">>;
  sendMessage(params: RpcParams<"session.send">): Promise<RpcResult<"session.send">>;
  interruptSession(params: RpcParams<"session.interrupt">): Promise<RpcResult<"session.interrupt">>;
  stopAgent(params: RpcParams<"agent.stop">): Promise<RpcResult<"agent.stop">>;
  setModel(params: RpcParams<"session.setModel">): Promise<RpcResult<"session.setModel">>;
  setPermissionMode(
    params: RpcParams<"session.setPermissionMode">,
  ): Promise<RpcResult<"session.setPermissionMode">>;
  answerQuestion(params: RpcParams<"question.answer">): Promise<RpcResult<"question.answer">>;
  conversation(
    params: RpcParams<"session.conversation">,
  ): Promise<RpcResult<"session.conversation">>;
  models(): Promise<RpcResult<"claude.models">>;

  onEvents(listener: (batch: EventsNotification) => void): Unsubscribe;
  onStatus(listener: (status: EngineStatus) => void): Unsubscribe;
  onConnection(listener: (connection: GatewayConnection) => void): Unsubscribe;
}
