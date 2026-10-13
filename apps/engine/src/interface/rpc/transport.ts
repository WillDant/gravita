import { createHash, timingSafeEqual } from "node:crypto";
import {
  AuthParams,
  type EngineStatus,
  Methods,
  Notifications,
  RPC_VERSION,
  RpcErrors,
  type RpcNotification,
  type RpcResponse,
} from "@gravita/protocol";
import type { ServerWebSocket } from "bun";
import { z } from "zod";
import type { EngineFeed, EngineListener } from "../../application/ports/event-publisher";
import { INTERNAL_ERROR, type RpcError, type RpcRouter } from "./router";

// JSON-RPC over one WebSocket on 127.0.0.1. Defenses, in order: Host allowlist (DNS
// rebinding), Origin allowlist on upgrade, then a token as the first message. Once
// authenticated, every request goes to the router.

export const TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost"];
export const WS_PATH = "/ws";

export interface TransportOptions {
  port: number;
  token: string;
  devOrigins?: string[];
  engineVersion: string;
  authTimeoutMs?: number;
}

export interface TransportDeps {
  router: RpcRouter;
  feed: EngineFeed;
  status: () => EngineStatus;
}

export interface RunningServer {
  port: number;
  stop(): void;
}

interface Conn {
  authed: boolean;
  timer?: ReturnType<typeof setTimeout>;
  listener?: EngineListener;
  unlisten?: () => void;
}

const RpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  method: z.string(),
  params: z.unknown().optional(),
});

const UNAUTHORIZED_CLOSE = 4001;

function sameToken(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function startTransport(deps: TransportDeps, opts: TransportOptions): RunningServer {
  const origins = new Set([...TAURI_ORIGINS, ...(opts.devOrigins ?? [])]);

  const send = (ws: ServerWebSocket<Conn>, msg: RpcResponse | RpcNotification) => {
    ws.send(JSON.stringify(msg));
  };
  const reply = (ws: ServerWebSocket<Conn>, id: number, result: unknown) =>
    send(ws, { jsonrpc: "2.0", id, result });
  const fail = (ws: ServerWebSocket<Conn>, id: number, error: RpcError) =>
    send(ws, { jsonrpc: "2.0", id, error });
  const reject = (ws: ServerWebSocket<Conn>, id: number) => {
    fail(ws, id, RpcErrors.unauthorized);
    ws.close(UNAUTHORIZED_CLOSE, "Unauthorized");
  };

  const authenticate = (ws: ServerWebSocket<Conn>, id: number, method: string, params: unknown) => {
    if (method !== Methods.auth) return reject(ws, id);
    const auth = AuthParams.safeParse(params);
    if (!auth.success || !sameToken(auth.data.token, opts.token)) return reject(ws, id);
    if (auth.data.rpcVersion !== RPC_VERSION) {
      fail(ws, id, {
        code: RpcErrors.badRequest.code,
        message: `Unsupported rpcVersion; engine speaks ${RPC_VERSION}`,
      });
      return ws.close(UNAUTHORIZED_CLOSE, "Unsupported rpcVersion");
    }
    ws.data.authed = true;
    clearTimeout(ws.data.timer);
    const listener: EngineListener = {
      status: (s) => send(ws, { jsonrpc: "2.0", method: Notifications.status, params: s }),
    };
    ws.data.listener = listener;
    ws.data.unlisten = deps.feed.listen(listener);
    reply(ws, id, { ok: true, engineVersion: opts.engineVersion });
    send(ws, { jsonrpc: "2.0", method: Notifications.status, params: deps.status() });
  };

  const handle = async (ws: ServerWebSocket<Conn>, id: number, method: string, params: unknown) => {
    if (method === Methods.auth)
      return reply(ws, id, { ok: true, engineVersion: opts.engineVersion });
    const outcome = await deps.router.dispatch(method, params);
    if ("error" in outcome) return fail(ws, id, outcome.error);
    reply(ws, id, outcome.result);
    // The snapshot flushed pending batches to other clients first; this client then gets
    // every event applied after the snapshot, and none before.
    if (method === Methods.snapshot && ws.data.listener && !ws.data.listener.events) {
      ws.data.listener.events = (n) =>
        send(ws, { jsonrpc: "2.0", method: Notifications.events, params: n });
    }
  };

  const server = Bun.serve<Conn>({
    hostname: "127.0.0.1",
    port: opts.port,
    fetch(req, srv) {
      const host = req.headers.get("host");
      if (host !== `127.0.0.1:${srv.port}` && host !== `localhost:${srv.port}`) {
        return new Response("Forbidden", { status: 403 });
      }
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") return Response.json({ ok: true });
      if (url.pathname === WS_PATH) {
        const origin = req.headers.get("origin");
        if (!origin || !origins.has(origin)) return new Response("Forbidden", { status: 403 });
        if (srv.upgrade(req, { data: { authed: false } })) return;
        return new Response("Upgrade required", { status: 426 });
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      maxPayloadLength: 64 * 1024,
      open(ws) {
        ws.data.timer = setTimeout(() => {
          if (!ws.data.authed) ws.close(UNAUTHORIZED_CLOSE, "Auth timeout");
        }, opts.authTimeoutMs ?? 2_000);
      },
      message(ws, raw) {
        let parsed: z.infer<typeof RpcRequestSchema>;
        try {
          parsed = RpcRequestSchema.parse(
            JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8")),
          );
        } catch {
          if (!ws.data.authed) return ws.close(UNAUTHORIZED_CLOSE, "Unauthorized");
          return send(ws, { jsonrpc: "2.0", id: -1, error: RpcErrors.badRequest });
        }
        const { id, method, params } = parsed;
        if (!ws.data.authed) return authenticate(ws, id, method, params);
        handle(ws, id, method, params).catch(() => fail(ws, id, INTERNAL_ERROR));
      },
      close(ws) {
        clearTimeout(ws.data.timer);
        ws.data.unlisten?.();
      },
    },
  });

  return {
    port: server.port ?? opts.port,
    stop: () => {
      void server.stop(true);
    },
  };
}
