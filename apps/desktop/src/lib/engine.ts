import type { GravitaState } from "@gravita/core";
import type {
  EngineStatus,
  EventsNotification,
  GravitaEvent,
  RpcNotification,
  RpcResponse,
} from "@gravita/protocol";
import { Methods, Notifications, RPC_VERSION } from "@gravita/protocol/constants";

export interface EngineEndpoint {
  url: string;
  token: string;
}

/** Tauri hands us the sidecar's port and token; the browser dev mode uses env or the URL. */
export async function resolveEndpoint(): Promise<EngineEndpoint> {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown };
  if (w.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ port: number; token: string }>("engine_info");
    return { url: `ws://127.0.0.1:${info.port}/ws`, token: info.token };
  }
  const q = new URLSearchParams(location.search);
  const port = q.get("port") ?? import.meta.env.VITE_ENGINE_PORT ?? "4319";
  const token = q.get("token") ?? import.meta.env.VITE_ENGINE_TOKEN ?? "dev-token";
  return { url: `ws://127.0.0.1:${port}/ws`, token };
}

export interface EngineHandlers {
  onOpen: (snapshot: { seq: number; state: GravitaState }) => void;
  onEvents: (batch: EventsNotification) => void;
  onStatus: (status: EngineStatus) => void;
  onClose: () => void;
}

/** JSON-RPC client over one WebSocket, with auth and automatic reconnect. */
export class EngineClient {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private closed = false;
  private retry = 0;

  constructor(
    private endpoint: EngineEndpoint,
    private handlers: EngineHandlers,
  ) {}

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    this.ws?.close();
  }

  private connect() {
    const ws = new WebSocket(this.endpoint.url);
    this.ws = ws;
    ws.onopen = async () => {
      try {
        await this.call(Methods.auth, { token: this.endpoint.token, rpcVersion: RPC_VERSION });
        const snapshot = (await this.call(Methods.snapshot, {})) as {
          seq: number;
          state: GravitaState;
        };
        this.retry = 0;
        this.handlers.onOpen(snapshot);
        const status = (await this.call(Methods.status, {})) as EngineStatus;
        this.handlers.onStatus(status);
      } catch {
        ws.close();
      }
    };
    ws.onmessage = (msg) => {
      let data: RpcResponse | RpcNotification;
      try {
        data = JSON.parse(String(msg.data));
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
        if (data.method === Notifications.events)
          this.handlers.onEvents(data.params as EventsNotification);
        else if (data.method === Notifications.status)
          this.handlers.onStatus(data.params as EngineStatus);
      }
    };
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error("closed"));
      this.pending.clear();
      this.handlers.onClose();
      if (this.closed) return;
      const delay = Math.min(10_000, 400 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  call(method: string, params?: unknown): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("not connected"));
    const id = this.nextId++;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error("timeout"));
      }, 15_000);
    });
  }

  async respondPermission(p: {
    sessionId: string;
    agentId: string;
    requestId: string;
    decision: "allow" | "deny";
  }): Promise<void> {
    await this.call(Methods.permissionRespond, p);
  }

  async sessionEvents(sessionId: string): Promise<GravitaEvent[]> {
    const r = (await this.call(Methods.sessionEvents, { sessionId })) as { events: GravitaEvent[] };
    return r.events;
  }
}
