import type { EngineStatus, EventsNotification, RpcParams, RpcResult } from "@gravita/protocol";
import type {
  EngineGateway,
  EngineSnapshot,
  GatewayConnection,
  Unsubscribe,
} from "@/infrastructure/engine/EngineGateway";
import type { GatewayError } from "@/infrastructure/engine/GatewayError";

/** The session-driving methods the fake records and can fail on demand. */
export type FakeCommand =
  | "startSession"
  | "sendMessage"
  | "interruptSession"
  | "stopAgent"
  | "setModel"
  | "setPermissionMode"
  | "answerQuestion"
  | "conversation"
  | "models"
  | "stopAll";

/** In-memory EngineGateway: tests push events and decide what each call returns. */
export class FakeGateway implements EngineGateway {
  connected = false;
  reconnects = 0;
  snapshotResult: EngineSnapshot | Error = {
    seq: 0,
    state: { projects: {}, sessions: {}, seq: 0 },
  };
  sessionEventsResult: RpcResult<"session.events"> | Error = { events: [] };
  readonly responded: RpcParams<"permission.respond">[] = [];
  readonly sessionEventCalls: RpcParams<"session.events">[] = [];
  private pendingSessionEvents: (() => void)[] = [];
  holdSessionEvents = false;

  /** Every session-driving call, in order. */
  readonly calls: { method: FakeCommand; params: unknown }[] = [];
  /** Makes the next calls of a method reject with this error (until cleared). */
  readonly failures: Partial<Record<FakeCommand, GatewayError>> = {};
  startResult: RpcResult<"session.start"> = { sessionId: "new-s", projectId: "p1" };
  conversationResult: RpcResult<"session.conversation"> = { messages: [] };
  modelsResult: RpcResult<"claude.models"> = {
    models: [
      { value: "default", displayName: "Default" },
      { value: "opus", displayName: "Opus" },
    ],
  };
  stopAllResult: RpcResult<"engine.stopAll"> = { stopped: 0 };
  /** Methods whose calls wait until `release()`. */
  readonly held = new Set<FakeCommand>();
  private pendingCalls: (() => void)[] = [];

  private readonly listeners = {
    events: new Set<(b: EventsNotification) => void>(),
    status: new Set<(s: EngineStatus) => void>(),
    connection: new Set<(c: GatewayConnection) => void>(),
  };

  connect() {
    this.connected = true;
  }
  close() {
    this.connected = false;
  }
  reconnect() {
    this.reconnects++;
  }

  async snapshot(): Promise<EngineSnapshot> {
    if (this.snapshotResult instanceof Error) throw this.snapshotResult;
    return this.snapshotResult;
  }

  sessionEvents(params: RpcParams<"session.events">): Promise<RpcResult<"session.events">> {
    this.sessionEventCalls.push(params);
    return new Promise((resolve, reject) => {
      const settle = () => {
        const r = this.sessionEventsResult;
        if (r instanceof Error) reject(r);
        else resolve(r);
      };
      if (this.holdSessionEvents) this.pendingSessionEvents.push(settle);
      else settle();
    });
  }

  /** Resolves calls held by `holdSessionEvents`. */
  releaseSessionEvents() {
    for (const settle of this.pendingSessionEvents.splice(0)) settle();
  }

  async respondPermission(
    params: RpcParams<"permission.respond">,
  ): Promise<RpcResult<"permission.respond">> {
    this.responded.push(params);
    return { ok: true };
  }

  private run<T>(method: FakeCommand, params: unknown, value: () => T): Promise<T> {
    this.calls.push({ method, params });
    return new Promise<T>((resolve, reject) => {
      const settle = () => {
        const failure = this.failures[method];
        if (failure) reject(failure);
        else resolve(value());
      };
      if (this.held.has(method)) this.pendingCalls.push(settle);
      else settle();
    });
  }

  /** Settles every held call. */
  release() {
    for (const settle of this.pendingCalls.splice(0)) settle();
  }

  callsOf(method: FakeCommand): unknown[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.params);
  }

  startSession(params: RpcParams<"session.start">) {
    return this.run("startSession", params, () => this.startResult);
  }
  sendMessage(params: RpcParams<"session.send">) {
    return this.run("sendMessage", params, () => ({ ok: true }) as const);
  }
  interruptSession(params: RpcParams<"session.interrupt">) {
    return this.run("interruptSession", params, () => ({ ok: true }) as const);
  }
  stopAgent(params: RpcParams<"agent.stop">) {
    return this.run("stopAgent", params, () => ({ ok: true }) as const);
  }
  setModel(params: RpcParams<"session.setModel">) {
    return this.run("setModel", params, () => ({ ok: true }) as const);
  }
  setPermissionMode(params: RpcParams<"session.setPermissionMode">) {
    return this.run("setPermissionMode", params, () => ({ ok: true }) as const);
  }
  answerQuestion(params: RpcParams<"question.answer">) {
    return this.run("answerQuestion", params, () => ({ ok: true }) as const);
  }
  conversation(params: RpcParams<"session.conversation">) {
    return this.run("conversation", params, () => this.conversationResult);
  }
  models() {
    return this.run("models", {}, () => this.modelsResult);
  }
  stopAll() {
    return this.run("stopAll", {}, () => this.stopAllResult);
  }

  onEvents(l: (b: EventsNotification) => void): Unsubscribe {
    this.listeners.events.add(l);
    return () => this.listeners.events.delete(l);
  }
  onStatus(l: (s: EngineStatus) => void): Unsubscribe {
    this.listeners.status.add(l);
    return () => this.listeners.status.delete(l);
  }
  onConnection(l: (c: GatewayConnection) => void): Unsubscribe {
    this.listeners.connection.add(l);
    return () => this.listeners.connection.delete(l);
  }

  emitConnection(c: GatewayConnection) {
    for (const l of this.listeners.connection) l(c);
  }
  emitEvents(batch: EventsNotification) {
    for (const l of this.listeners.events) l(batch);
  }
  emitStatus(s: EngineStatus) {
    for (const l of this.listeners.status) l(s);
  }
}

/** Lets pending promise callbacks run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
