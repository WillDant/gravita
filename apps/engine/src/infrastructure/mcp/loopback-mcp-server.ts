import { createHash, randomBytes } from "node:crypto";
import { HttpPaths } from "@gravita/protocol/constants";
import { z } from "zod";
import type { RoleTool, ToolReply } from "../../application/ports/chat-runtime";

// Gravita's role tools for agents that can't host an in-process MCP server (Codex): the
// same handlers Claude Code sessions get in-process, served as an MCP server over HTTP on
// the engine's own loopback port (`/mcp`, next to `/hooks`). One implementation, two
// transports.
//
// Each squad session mounts its own tool set (already bound by closure to its squad, role,
// task and attempt) under a random token, and its agent presents that token as a Bearer
// header. The token picks the tool set, so no request can act for another session; a
// request without a known token, or from a browser (any Origin header), is refused.
//
// The MCP side is the "streamable HTTP" transport in its simplest legal form: every POST
// carries JSON-RPC and is answered with one JSON body (no server-sent events, no sessions),
// which is all the tools need: they answer each call, and never call the agent back.

/** The route on the engine's port. */
export const MCP_PATH = HttpPaths.mcp;

/** The MCP revisions this server speaks, newest first. */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

/** A tool call's body is small; this bounds what one request may make the engine parse. */
export const MAX_MCP_BODY_BYTES = 256 * 1024;

/** A session's mount: where its agent reaches the tools, and with what. */
export interface McpMount {
  url: string;
  token: string;
  /** Unmounts: the token stops working at once. */
  close(): void;
}

interface Mounted {
  tools: ReadonlyMap<string, RoleTool>;
  label: string;
}

type JsonRpcId = string | number | null;

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: JsonRpcId;
  method?: unknown;
  params?: unknown;
}

const plain = (status: number, text: string) => new Response(text, { status });

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/** The token of `Authorization: Bearer <token>`, if any. */
function bearer(req: Request): string | undefined {
  return /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "")?.[1];
}

export class LoopbackMcpServer {
  /** Mounts by the hash of their token (the token itself is never kept as a key). */
  private readonly mounts = new Map<string, Mounted>();
  private origin: string | undefined;

  constructor(private readonly o: { name: string; version: string }) {}

  /** The engine's port is known once it listens; mounts need it. */
  attach(port: number) {
    this.origin = `http://127.0.0.1:${port}`;
  }

  get attached(): boolean {
    return this.origin !== undefined;
  }

  /** Serves `tools` to one session until the mount is closed. */
  mount(tools: readonly RoleTool[], label: string): McpMount {
    if (!this.origin) throw new Error("Gravita's role tools aren't being served yet");
    const token = randomBytes(32).toString("hex");
    const key = hashOf(token);
    this.mounts.set(key, { tools: new Map(tools.map((t) => [t.name, t])), label });
    return {
      url: `${this.origin}${MCP_PATH}`,
      token,
      close: () => {
        this.mounts.delete(key);
      },
    };
  }

  /** How many sessions have tools mounted (tests). */
  get size(): number {
    return this.mounts.size;
  }

  /** Answers one HTTP request to `/mcp`. */
  async handle(req: Request): Promise<Response> {
    // Never for browsers: a page can't reach the tools even if it learned a token.
    if (req.headers.has("origin")) return plain(403, "Forbidden");
    const token = bearer(req);
    const mounted = token ? this.mounts.get(hashOf(token)) : undefined;
    if (!mounted) return plain(401, "Unauthorized");
    // The session ending is the mount closing; nothing to do for the client's goodbye.
    if (req.method === "DELETE") return new Response(null, { status: 204 });
    // No server-sent stream: the tools never call the agent back.
    if (req.method !== "POST") return plain(405, "Method not allowed");
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_MCP_BODY_BYTES) return plain(413, "Payload too large");
    let body: unknown;
    try {
      const raw = await req.arrayBuffer();
      if (raw.byteLength > MAX_MCP_BODY_BYTES) return plain(413, "Payload too large");
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
    }
    const batch = Array.isArray(body);
    const messages = (batch ? body : [body]) as JsonRpcMessage[];
    const replies: unknown[] = [];
    for (const m of messages) {
      const reply = await this.answer(mounted, m);
      if (reply) replies.push(reply);
    }
    // Only notifications (or responses): accepted, nothing to say.
    if (!replies.length) return new Response(null, { status: 202 });
    return Response.json(batch ? replies : replies[0]);
  }

  private async answer(mounted: Mounted, m: JsonRpcMessage): Promise<unknown | undefined> {
    if (!m || typeof m !== "object" || typeof m.method !== "string") {
      // A response from the client (we never ask it anything) or garbage.
      return m && typeof m === "object" && "id" in m && !("result" in m || "error" in m)
        ? rpcError(m.id ?? null, -32600, "Invalid request")
        : undefined;
    }
    const isRequest = m.id !== undefined && m.id !== null;
    if (!isRequest) return undefined;
    const id = m.id as JsonRpcId;
    const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<
      string,
      unknown
    >;
    switch (m.method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
          ? asked
          : MCP_PROTOCOL_VERSIONS[0];
        return rpcResult(id, {
          protocolVersion: version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: this.o.name, version: this.o.version },
          instructions: "Gravita's tools for your role in this squad.",
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, {
          tools: [...mounted.tools.values()].map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: inputSchema(t),
          })),
        });
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const tool = mounted.tools.get(name);
        if (!tool) return rpcResult(id, toolResult({ text: `No tool "${name}".`, isError: true }));
        const args = (
          params.arguments && typeof params.arguments === "object" ? params.arguments : {}
        ) as Record<string, unknown>;
        const parsed = z.object(tool.input).safeParse(args);
        if (!parsed.success)
          return rpcResult(
            id,
            toolResult({
              text: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`,
              isError: true,
            }),
          );
        try {
          return rpcResult(id, toolResult(await tool.handler(parsed.data)));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return rpcResult(
            id,
            toolResult({ text: `Gravita couldn't run ${name}: ${message}`, isError: true }),
          );
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${m.method}`);
    }
  }
}

/** A tool's arguments as JSON Schema (what the agent sees). */
function inputSchema(t: RoleTool): Record<string, unknown> {
  const { $schema: _, ...schema } = z.toJSONSchema(z.object(t.input)) as Record<string, unknown>;
  return schema;
}

function toolResult(reply: ToolReply) {
  return {
    content: [{ type: "text", text: reply.text }],
    ...(reply.isError ? { isError: true } : {}),
  };
}

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });

const rpcError = (id: JsonRpcId, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});
