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
  type TerminalOutput,
  type TerminalUpdate,
} from "@gravita/protocol";
import { HttpPaths } from "@gravita/protocol/constants";
import type { ServerWebSocket } from "bun";
import { z } from "zod";
import type { EngineFeed, EngineListener } from "../../application/ports/event-publisher";
import type { TerminalListener } from "../../application/services/terminal-manager";
import { INTERNAL_ERROR, type RpcError, type RpcRouter } from "./router";

// JSON-RPC over one WebSocket on 127.0.0.1. Defenses, in order: Host allowlist (DNS
// rebinding), Origin allowlist on upgrade, then a token as the first message. Once
// authenticated, every request goes to the router.
//
// Plain HTTP routes serve callers that aren't the UI: the tray's kill switch
// (`POST /control/stop-all`, engine token), Deep Observe hooks (`POST /hooks`, hook token)
// and Gravita's role tools for Codex squad sessions (`/mcp`, a token per session). None is
// for browsers: any request with an Origin header is refused, so a web page can't reach
// them even with a token, and the token travels as a Bearer header.

export const TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost"];
export const WS_PATH = "/ws";
export const MAX_PAYLOAD_BYTES = 256 * 1024;

export interface TransportOptions {
  port: number;
  token: string;
  /** The token Deep Observe hooks present (from the runtime file); no hooks route without it. */
  hookToken?: string;
  devOrigins?: string[];
  engineVersion: string;
  authTimeoutMs?: number;
}

/** Takes a hook payload; must return at once (the hook is answered before it is ingested). */
export interface HookSink {
  submit(payload: unknown): void;
}

/** Answers the role tools' MCP route (it checks its own per-session tokens). */
export interface McpRoute {
  handle(req: Request): Promise<Response>;
}

export interface TransportDeps {
  router: RpcRouter;
  feed: EngineFeed;
  status: () => EngineStatus;
  hooks?: HookSink;
  mcp?: McpRoute;
  /** Embedded terminals: their output and changes go to every authenticated client. */
  terminals?: { listen(l: TerminalListener): () => void };
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
  unlistenTerminals?: () => void;
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

/** Checks `Authorization: Bearer <token>` in constant time. */
function bearerMatches(req: Request, expected: string): boolean {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return sameToken(m?.[1] ?? "", expected);
}

const plain = (status: number, text: string) => new Response(text, { status });

/** Gate of the non-browser routes: POST only, no Origin, the right Bearer token. */
function refuse(req: Request, token: string): Response | undefined {
  if (req.method !== "POST") return plain(405, "Method not allowed");
  if (req.headers.has("origin")) return plain(403, "Forbidden");
  if (!bearerMatches(req, token)) return plain(401, "Unauthorized");
  return undefined;
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
    ws.data.unlistenTerminals = deps.terminals?.listen({
      output: (terminalId, data) =>
        send(ws, {
          jsonrpc: "2.0",
          method: Notifications.terminalOutput,
          params: { terminalId, data } satisfies TerminalOutput,
        }),
      update: (update) =>
        send(ws, {
          jsonrpc: "2.0",
          method: Notifications.terminalUpdate,
          params: update satisfies TerminalUpdate,
        }),
    });
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

  const stopAll = async (req: Request): Promise<Response> => {
    const refused = refuse(req, opts.token);
    if (refused) return refused;
    const outcome = await deps.router.dispatch(Methods.stopAll, undefined);
    if ("error" in outcome) return Response.json({ error: outcome.error }, { status: 500 });
    return Response.json(outcome.result);
  };

  const hooks = async (req: Request, sink: HookSink, hookToken: string): Promise<Response> => {
    const refused = refuse(req, hookToken);
    if (refused) return refused;
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_PAYLOAD_BYTES) return plain(413, "Payload too large");
    let body: ArrayBuffer;
    try {
      body = await req.arrayBuffer();
    } catch {
      return plain(413, "Payload too large");
    }
    if (body.byteLength > MAX_PAYLOAD_BYTES) return plain(413, "Payload too large");
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return plain(400, "Invalid JSON");
    }
    // Answer first: the hook (and Claude Code behind it) never waits on the database.
    setImmediate(() => sink.submit(payload));
    return new Response(null, { status: 204 });
  };

  const server = Bun.serve<Conn>({
    hostname: "127.0.0.1",
    port: opts.port,
    // Hooks are the largest bodies; nothing else posts one.
    maxRequestBodySize: MAX_PAYLOAD_BYTES + 1024,
    fetch(req, srv) {
      const host = req.headers.get("host");
      if (host !== `127.0.0.1:${srv.port}` && host !== `localhost:${srv.port}`) {
        return new Response("Forbidden", { status: 403 });
      }
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") return Response.json({ ok: true });
      if (url.pathname === HttpPaths.stopAll) return stopAll(req);
      if (url.pathname === HttpPaths.hooks && deps.hooks && opts.hookToken)
        return hooks(req, deps.hooks, opts.hookToken);
      if (url.pathname === HttpPaths.mcp && deps.mcp) {
        // A role tool may run for minutes (complete_task commits and runs the checks): no
        // idle timeout cuts its request (Bun's default is 10 s).
        srv.timeout(req, 0);
        return deps.mcp.handle(req);
      }
      if (url.pathname === WS_PATH) {
        const origin = req.headers.get("origin");
        if (!origin || !origins.has(origin)) return new Response("Forbidden", { status: 403 });
        if (srv.upgrade(req, { data: { authed: false } })) return;
        return new Response("Upgrade required", { status: 426 });
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      // session.start/send allow 32k characters; escaped or multi-byte text can be ~6× that.
      maxPayloadLength: MAX_PAYLOAD_BYTES,
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
        ws.data.unlistenTerminals?.();
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
