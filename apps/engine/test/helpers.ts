import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GravitaEvent, RpcNotification, RpcResponse } from "@gravita/protocol";

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "gravita-engine-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function event(partial: Partial<GravitaEvent> & Pick<GravitaEvent, "key">): GravitaEvent {
  return {
    ts: "2026-10-12T10:00:00.000Z",
    source: "fake",
    provider: "claude",
    projectId: "p1",
    sessionId: "s1",
    type: "message.user",
    data: { uuid: partial.key, textPreview: "hi", origin: "human" },
    ...partial,
  } as GravitaEvent;
}

/** Minimal JSON-RPC client over Bun's WebSocket (which can set the Origin header). */
export class TestClient {
  readonly ws: WebSocket;
  readonly opened: Promise<boolean>;
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly notifications: RpcNotification[] = [];
  private nextId = 1;
  private readonly pending = new Map<number, (r: RpcResponse) => void>();
  private readonly waiters = new Set<() => void>();

  constructor(url: string, origin?: string) {
    this.ws = new WebSocket(url, origin ? { headers: { Origin: origin } } : {});
    this.opened = new Promise((resolve) => {
      this.ws.addEventListener("open", () => resolve(true));
      this.ws.addEventListener("close", () => resolve(false));
    });
    this.closed = new Promise((resolve) => {
      this.ws.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason }));
    });
    this.ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data)) as RpcResponse | RpcNotification;
      if ("id" in msg && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!(msg);
        this.pending.delete(msg.id);
      } else if ("method" in msg) {
        this.notifications.push(msg);
        for (const w of this.waiters) w();
      }
    });
  }

  call(method: string, params?: unknown, timeoutMs = 5_000): Promise<RpcResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.ws.send(
        JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }),
      );
    });
  }

  waitFor(pred: (n: RpcNotification) => boolean, timeoutMs = 5_000): Promise<RpcNotification> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const hit = this.notifications.find(pred);
        if (!hit) return;
        cleanup();
        resolve(hit);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("notification timed out"));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters.delete(check);
      };
      this.waiters.add(check);
      check();
    });
  }

  close() {
    this.ws.close();
  }
}
