import { describe, expect, test } from "bun:test";
import { JsonRpcError } from "@gravita/adapter-codex";
import { CursorAcpClient } from "../src";
import { cursorAcpScript, ScriptedAcpServer } from "../src/testing/scripted-acp-server";
import { acpSid, CWD, connect } from "./helpers";

describe("CursorAcpClient", () => {
  test("the handshake declares no file system or terminal, and every message is JSON-RPC 2.0", async () => {
    const c = connect("streaming-reply", 1);
    const init = await c.client.initialize({ name: "gravita", version: "test" });
    expect(init.protocolVersion).toBe(1);
    const session = await c.client.call("session/new", { cwd: CWD, mcpServers: [] });
    expect(session.sessionId).toBe(acpSid(1));
    expect(session.models?.currentModelId).toBe("default[]");
    expect(session.modes?.availableModes.map((m) => m.id)).toEqual(["agent", "plan", "ask"]);
    expect(c.server.received.every((m) => m.jsonrpc === "2.0")).toBe(true);
    expect(c.server.sent("authenticate")).toEqual([]);
    c.client.close();
  });

  test("a refused session/new keeps its code and message", async () => {
    for (const [scenario, code] of [
      ["auth-error", -32000],
      ["invalid-key", -32603],
    ] as const) {
      const c = connect(scenario, 1);
      await c.client.initialize({ name: "gravita" });
      const err = await c.client.call("session/new", { cwd: CWD, mcpServers: [] }).catch((e) => e);
      expect(err).toBeInstanceOf(JsonRpcError);
      expect((err as JsonRpcError).code).toBe(code);
      expect(c.server.failures).toEqual([]);
    }
  });

  test("requests Gravita doesn't serve are refused at once", async () => {
    const server = new ScriptedAcpServer([
      { ask: { id: 9, method: "fs/read_text_file", params: { path: "/etc/hosts" } } },
    ]);
    const client = new CursorAcpClient(server.transport, {
      onRequest: () => Promise.resolve({ ok: true }),
    });
    await server.finished;
    const answer = server.received.find((m) => m.id === 9);
    expect(answer?.error).toMatchObject({ code: -32601 });
    client.close();
  });

  test("a crash closes the client and fails the turn in flight", async () => {
    const server = new ScriptedAcpServer(cursorAcpScript("process-crash"));
    let closed = false;
    const client = new CursorAcpClient(server.transport, {
      onClose: () => {
        closed = true;
      },
    });
    await client.initialize({ name: "gravita" });
    const { sessionId } = await client.call("session/new", { cwd: CWD, mcpServers: [] });
    const err = await client
      .call("session/prompt", { sessionId, prompt: [{ type: "text", text: "Plan" }] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    await client.closed;
    expect(closed).toBe(true);
    expect(client.isOpen).toBe(false);
    expect(await server.exited).toBe(1);
  });
});
