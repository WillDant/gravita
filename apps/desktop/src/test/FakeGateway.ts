import type { EngineStatus, EventsNotification, RpcParams, RpcResult } from "@gravita/protocol";
import type {
  EngineGateway,
  EngineSnapshot,
  GatewayConnection,
  Unsubscribe,
} from "@/infrastructure/engine/EngineGateway";

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
