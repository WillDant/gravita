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
  /** The models a provider offers (`models.list`). */
  models(params: RpcParams<"models.list">): Promise<RpcResult<"models.list">>;
  /** The kill switch: stops every session Gravita runs (the tray calls it over HTTP too). */
  stopAll(): Promise<RpcResult<"engine.stopAll">>;

  // Squads: a team of role agents working one approved plan. Same error contract.
  createSquad(params: RpcParams<"squad.create">): Promise<RpcResult<"squad.create">>;
  /** Ends the brief conversation: the planner writes the plan. */
  planSquad(params: RpcParams<"squad.plan">): Promise<RpcResult<"squad.plan">>;
  replanSquad(params: RpcParams<"squad.replan">): Promise<RpcResult<"squad.replan">>;
  approvePlan(params: RpcParams<"squad.approvePlan">): Promise<RpcResult<"squad.approvePlan">>;
  pauseSquad(params: RpcParams<"squad.pause">): Promise<RpcResult<"squad.pause">>;
  resumeSquad(params: RpcParams<"squad.resume">): Promise<RpcResult<"squad.resume">>;
  stopSquad(params: RpcParams<"squad.stop">): Promise<RpcResult<"squad.stop">>;
  retryTask(params: RpcParams<"squad.task.retry">): Promise<RpcResult<"squad.task.retry">>;
  skipTask(params: RpcParams<"squad.task.skip">): Promise<RpcResult<"squad.task.skip">>;
  reassignTask(params: RpcParams<"squad.task.reassign">): Promise<RpcResult<"squad.task.reassign">>;
  deliverSquad(params: RpcParams<"squad.deliver">): Promise<RpcResult<"squad.deliver">>;

  onEvents(listener: (batch: EventsNotification) => void): Unsubscribe;
  onStatus(listener: (status: EngineStatus) => void): Unsubscribe;
  onConnection(listener: (connection: GatewayConnection) => void): Unsubscribe;
}
