import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import type { RoleTool } from "../../src/application/ports/chat-runtime";
import { roleToolArgs } from "../../src/infrastructure/codex/codex-app-server-runtime";
import { LoopbackMcpServer } from "../../src/infrastructure/mcp/loopback-mcp-server";
import { serveMcp } from "../codex-squad-fakes";

// Gravita's role tools over loopback HTTP, for Codex: each session's tools sit behind a
// token of their own, so one session can never call another's (they are bound by closure
// to their squad, role, task and attempt); browsers and strangers are refused.

/** A tool set bound to one role, as role-tools.ts builds them. */
function toolsFor(role: string, calls: string[]): RoleTool[] {
  return [
    {
      name: "whoami",
      description: "Who you are.",
      input: {},
      handler: async () => ({ text: `role ${role}` }),
    },
    {
      name: "complete_task",
      description: "Finish.",
      input: { summary: z.string().min(1).max(100) },
      handler: async (a) => {
        calls.push(`${role}:${String(a.summary)}`);
        return { text: "committed" };
      },
    },
    {
      name: "explode",
      description: "Fails.",
      input: {},
      handler: async () => {
        throw new Error("kaboom");
      },
    },
  ];
}

let stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
});

function server() {
  const mcp = new LoopbackMcpServer({ name: "gravita", version: "0.0.0-test" });
  const served = serveMcp(mcp);
  stops.push(served.stop);
  return mcp;
}

const rpc = (method: string, params: unknown = {}, id: number | null = 1) => ({
  jsonrpc: "2.0",
  ...(id !== null ? { id } : {}),
  method,
  params,
});

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// biome-ignore lint/suspicious/noExplicitAny: JSON-RPC answers are read loosely here.
type Json = any;
const json = (r: Response): Promise<Json> => r.json();

describe("the role tools' loopback MCP route", () => {
  test("speaks MCP: initialize, tools/list with JSON Schemas, tools/call", async () => {
    const mcp = server();
    const calls: string[] = [];
    const m = mcp.mount(toolsFor("backend", calls), "q/backend/t1");
    expect(m.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const init = await json(
      await post(m.url, rpc("initialize", { protocolVersion: "2025-06-18" }), bearer(m.token)),
    );
    expect(init.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "gravita" },
    });
    const ack = await post(m.url, rpc("notifications/initialized", {}, null), bearer(m.token));
    expect(ack.status).toBe(202);
    const list = await json(await post(m.url, rpc("tools/list"), bearer(m.token)));
    const complete = list.result.tools.find((t: { name: string }) => t.name === "complete_task");
    expect(complete.inputSchema).toMatchObject({
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    });
    expect(complete.inputSchema.$schema).toBeUndefined();
    const call = await json(
      await post(
        m.url,
        rpc("tools/call", { name: "complete_task", arguments: { summary: "Done" } }),
        bearer(m.token),
      ),
    );
    expect(call.result).toEqual({ content: [{ type: "text", text: "committed" }] });
    expect(calls).toEqual(["backend:Done"]);
  });

  test("a token reaches only its own session's tools", async () => {
    const mcp = server();
    const calls: string[] = [];
    const backend = mcp.mount(toolsFor("backend", calls), "backend");
    const frontend = mcp.mount(toolsFor("frontend", calls), "frontend");
    const who = async (token: string) =>
      (await json(await post(backend.url, rpc("tools/call", { name: "whoami" }), bearer(token))))
        .result.content[0].text;
    expect(await who(backend.token)).toBe("role backend");
    expect(await who(frontend.token)).toBe("role frontend");
    expect(backend.token).not.toBe(frontend.token);
  });

  test("no token, a wrong one, a closed mount or a browser are refused", async () => {
    const mcp = server();
    const m = mcp.mount(toolsFor("backend", []), "backend");
    expect((await post(m.url, rpc("tools/list"))).status).toBe(401);
    expect((await post(m.url, rpc("tools/list"), bearer("f".repeat(64)))).status).toBe(401);
    expect(
      (await post(m.url, rpc("tools/list"), { ...bearer(m.token), Origin: "https://evil.example" }))
        .status,
    ).toBe(403);
    m.close();
    expect((await post(m.url, rpc("tools/list"), bearer(m.token))).status).toBe(401);
    expect(mcp.size).toBe(0);
  });

  test("no event stream; a goodbye is fine; bad input is an error, never a crash", async () => {
    const mcp = server();
    const m = mcp.mount(toolsFor("backend", []), "backend");
    expect((await fetch(m.url, { headers: bearer(m.token) })).status).toBe(405);
    expect((await fetch(m.url, { method: "DELETE", headers: bearer(m.token) })).status).toBe(204);
    const garbage = await fetch(m.url, {
      method: "POST",
      headers: { ...bearer(m.token), "content-type": "application/json" },
      body: "{nope",
    });
    expect(garbage.status).toBe(400);
    const tooBig = await post(m.url, rpc("ping", { pad: "x".repeat(300 * 1024) }), bearer(m.token));
    expect(tooBig.status).toBe(413);
    const unknown = await json(await post(m.url, rpc("resources/list"), bearer(m.token)));
    expect(unknown.error.code).toBe(-32601);
    const call = async (name: string, args: unknown = {}) =>
      (await json(await post(m.url, rpc("tools/call", { name, arguments: args }), bearer(m.token))))
        .result;
    expect(await call("nope")).toMatchObject({ isError: true });
    expect((await call("complete_task", { summary: "" })).content[0].text).toContain(
      "Invalid arguments for complete_task",
    );
    expect(await call("explode")).toEqual({
      content: [{ type: "text", text: "Gravita couldn't run explode: kaboom" }],
      isError: true,
    });
    // A batch gets a batch.
    const batch = await json(
      await post(m.url, [rpc("ping", {}, 1), rpc("ping", {}, 2)], bearer(m.token)),
    );
    expect(batch.map((r: { id: number }) => r.id)).toEqual([1, 2]);
  });

  test("nothing is mounted before the engine listens", () => {
    const mcp = new LoopbackMcpServer({ name: "gravita", version: "0" });
    expect(() => mcp.mount([], "x")).toThrow("aren't being served yet");
  });
});

describe("Codex's configuration of the role tools", () => {
  test("a streamable HTTP server, its token from the environment, required and pre-approved", () => {
    expect(roleToolArgs("http://127.0.0.1:4319/mcp")).toEqual([
      "-c",
      'mcp_servers.gravita.url="http://127.0.0.1:4319/mcp"',
      "-c",
      'mcp_servers.gravita.bearer_token_env_var="GRAVITA_MCP_TOKEN"',
      "-c",
      "mcp_servers.gravita.required=true",
      "-c",
      'mcp_servers.gravita.default_tools_approval_mode="approve"',
      "-c",
      "mcp_servers.gravita.startup_timeout_sec=20",
      "-c",
      "mcp_servers.gravita.tool_timeout_sec=3600",
    ]);
  });
});
