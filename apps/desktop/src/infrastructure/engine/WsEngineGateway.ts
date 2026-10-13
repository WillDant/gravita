import type {
  EngineStatus,
  EventsNotification,
  RpcMethod,
  RpcNotification,
  RpcParams,
  RpcResponse,
  RpcResult,
} from "@gravita/protocol";
import { Methods, Notifications, RPC_VERSION } from "@gravita/protocol/constants";
import type {
  EngineGateway,
  EngineSnapshot,
  GatewayConnection,
  Unsubscribe,
} from "./EngineGateway";
import type { EngineEndpoint } from "./resolveEndpoint";

const CALL_TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 10_000;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

function listeners<T>() {
  const set = new Set<(value: T) => void>();
  return {
    add(fn: (value: T) => void): Unsubscribe {
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(value: T) {
      for (const fn of set) fn(value);
    },
  };
}

/** JSON-RPC 2.0 over one WebSocket, with auth and automatic reconnect. */
export class WsEngineGateway implements EngineGateway {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = true;
  private retry = 0;
  /** Bumped on every open and close, so a superseded socket's late close is ignored. */
  private generation = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private endpoint?: Promise<EngineEndpoint>;
  private readonly events = listeners<EventsNotification>();
  private readonly status = listeners<EngineStatus>();
  private readonly connection = listeners<GatewayConnection>();

  /** `endpoint` is resolved once, on first connect (Tauri asks the shell for it). */
  constructor(private readonly resolve: () => Promise<EngineEndpoint>) {}

  connect(): void {
    if (!this.closed) return;
    this.closed = false;
    void this.open();
  }

  close(): void {
    this.closed = true;
    this.generation++;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = undefined;
  }

  reconnect(): void {
    this.ws?.close();
  }

  async snapshot(): Promise<EngineSnapshot> {
    const snapshot = (await this.call(Methods.snapshot, {})) as EngineSnapshot;
    // A full snapshot means the link is healthy: the next drop retries quickly again.
    this.retry = 0;
    return snapshot;
  }

  sessionEvents(params: RpcParams<"session.events">): Promise<RpcResult<"session.events">> {
    return this.call(Methods.sessionEvents, params);
  }

  respondPermission(
    params: RpcParams<"permission.respond">,
  ): Promise<RpcResult<"permission.respond">> {
    return this.call(Methods.permissionRespond, params);
  }

  onEvents(listener: (batch: EventsNotification) => void): Unsubscribe {
    return this.events.add(listener);
  }

  onStatus(listener: (status: EngineStatus) => void): Unsubscribe {
    return this.status.add(listener);
  }

  onConnection(listener: (connection: GatewayConnection) => void): Unsubscribe {
    return this.connection.add(listener);
  }

  private async open() {
    const generation = ++this.generation;
    this.endpoint ??= this.resolve();
    let endpoint: EngineEndpoint;
    try {
      endpoint = await this.endpoint;
    } catch {
      this.endpoint = undefined;
      this.scheduleRetry();
      return;
    }
    if (this.closed || generation !== this.generation) return;
    const ws = new WebSocket(endpoint.url);
    this.ws = ws;
    ws.onopen = async () => {
      try {
        await this.call(Methods.auth, { token: endpoint.token, rpcVersion: RPC_VERSION });
      } catch {
        ws.close();
        return;
      }
      this.connection.emit("online");
      this.call(Methods.status, {}).then(
        (status) => this.status.emit(status),
        () => {},
      );
    };
    ws.onmessage = (msg) => this.receive(msg.data);
    ws.onclose = () => {
      if (generation !== this.generation) return;
      this.ws = undefined;
      for (const p of this.pending.values()) p.reject(new Error("closed"));
      this.pending.clear();
      this.connection.emit("offline");
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.closed) return;
    const delay = Math.min(MAX_BACKOFF_MS, 400 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => void this.open(), delay);
  }

  private receive(raw: unknown) {
    let data: RpcResponse | RpcNotification;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }
    if ("id" in data && typeof data.id === "number") {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error.message));
      else p.resolve(data.result);
      return;
    }
    if ("method" in data) {
      if (data.method === Notifications.events) this.events.emit(data.params as EventsNotification);
      else if (data.method === Notifications.status) this.status.emit(data.params as EngineStatus);
    }
  }

  /**
   * The one place wire data meets the contract. The engine validates params and results
   * against the same `RpcContract`, so the UI trusts the shape instead of shipping zod.
   */
  private call<M extends RpcMethod>(method: M, params: RpcParams<M>): Promise<RpcResult<M>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("not connected"));
    const id = this.nextId++;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise<RpcResult<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as RpcResult<M>), reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error("timeout"));
      }, CALL_TIMEOUT_MS);
    });
  }
}
