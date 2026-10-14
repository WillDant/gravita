import { describe, expect, test } from "bun:test";
import {
  JsonRpcClosedError,
  JsonRpcConnection,
  JsonRpcError,
  JsonRpcTimeoutError,
  RpcCodes,
  type RpcTransport,
} from "../src";

/** A peer we drive by hand: chunks we push reach the connection, lines it sends are kept. */
function peer() {
  const chunks: (string | Uint8Array)[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  const sent: Record<string, unknown>[] = [];
  let closedByClient = false;
  const transport: RpcTransport = {
    incoming: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const c = chunks.shift();
          if (c !== undefined) {
            yield c;
            continue;
          }
          if (ended) return;
          await new Promise<void>((r) => {
            wake = r;
          });
        }
      },
    },
    send: (line) => {
      expect(line.endsWith("\n")).toBe(true);
      sent.push(JSON.parse(line));
    },
    close: () => {
      closedByClient = true;
      ended = true;
      wake?.();
    },
  };
  return {
    transport,
    sent,
    get closedByClient() {
      return closedByClient;
    },
    push(c: string | Uint8Array) {
      chunks.push(c);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("JSON-RPC over lines", () => {
  test("a request gets its own answer, whatever order answers come in", async () => {
    const p = peer();
    const c = new JsonRpcConnection(p.transport);
    const a = c.request("model/list", {});
    const b = c.request("account/read", {});
    expect(p.sent.map((m) => [m.id, m.method])).toEqual([
      [1, "model/list"],
      [2, "account/read"],
    ]);
    p.push(`${JSON.stringify({ id: 2, result: { account: null } })}\n`);
    p.push(`${JSON.stringify({ id: 1, result: { data: [] } })}\n`);
    expect(await a).toEqual({ data: [] });
    expect(await b).toEqual({ account: null });
  });

  test("reassembles messages split across chunks, and splits chunks holding several", async () => {
    const p = peer();
    const notes: [string, unknown][] = [];
    const c = new JsonRpcConnection(p.transport, {
      onNotification: (m, params) => notes.push([m, params]),
    });
    const r = c.request("thread/start", { cwd: "/w" });
    const one = JSON.stringify({ method: "turn/started", params: { n: 1 } });
    const two = JSON.stringify({ method: "turn/completed", params: { n: 2 } });
    const three = JSON.stringify({ id: 1, result: { ok: "ü" } });
    const all = new TextEncoder().encode(`${one}\n${two}\n${three}\n`);
    // Byte chunks that cut a multi-byte character in half too.
    for (let i = 0; i < all.length; i += 7) p.push(all.subarray(i, i + 7));
    expect(await r).toEqual({ ok: "ü" });
    expect(notes).toEqual([
      ["turn/started", { n: 1 }],
      ["turn/completed", { n: 2 }],
    ]);
  });

  test("answers the server's requests with the handler's result or error", async () => {
    const p = peer();
    new JsonRpcConnection(p.transport, {
      onRequest: async (method, params) => {
        if (method === "item/commandExecution/requestApproval") return { decision: "accept" };
        if ((params as { fail?: boolean }).fail) throw new Error("boom");
        throw new JsonRpcError(-32001, "nope", { why: "test" });
      },
    });
    p.push(
      `${JSON.stringify({ id: 0, method: "item/commandExecution/requestApproval", params: {} })}\n`,
    );
    p.push(`${JSON.stringify({ id: "x", method: "other", params: { fail: true } })}\n`);
    p.push(`${JSON.stringify({ id: "y", method: "other", params: {} })}\n`);
    await tick();
    expect(p.sent).toEqual([
      { id: 0, result: { decision: "accept" } },
      { id: "x", error: { code: RpcCodes.internalError, message: "boom" } },
      { id: "y", error: { code: -32001, message: "nope", data: { why: "test" } } },
    ]);
  });

  test("without a handler every server request is refused, so the server never waits", async () => {
    const p = peer();
    new JsonRpcConnection(p.transport);
    p.push(`${JSON.stringify({ id: 7, method: "item/tool/call", params: {} })}\n`);
    await tick();
    expect(p.sent[0]).toMatchObject({ id: 7, error: { code: RpcCodes.methodNotFound } });
  });

  test("an error answer rejects with its code, message and data", async () => {
    const p = peer();
    const c = new JsonRpcConnection(p.transport);
    const r = c.request("turn/steer", {});
    p.push(
      `${JSON.stringify({ id: 1, error: { code: -32600, message: "no active turn", data: 1 } })}\n`,
    );
    const err = await r.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JsonRpcError);
    expect(err).toMatchObject({ code: -32600, message: "no active turn", data: 1 });
  });

  test("junk, oversized lines and stray answers are reported and skipped", async () => {
    const p = peer();
    const problems: string[] = [];
    const notes: string[] = [];
    new JsonRpcConnection(p.transport, {
      maxLineChars: 64,
      onProtocolError: (m) => problems.push(m),
      onNotification: (m) => notes.push(m),
    });
    p.push("not json\n");
    p.push("[1,2]\n");
    p.push(`${JSON.stringify({ id: 99, result: {} })}\n`);
    p.push(`${JSON.stringify({ method: "big", params: { pad: "x".repeat(100) } })}\n`);
    // A huge line arriving in pieces is dropped without buffering it all.
    p.push("x".repeat(50));
    p.push("x".repeat(50));
    p.push(`${"x".repeat(50)}\n`);
    p.push(`${JSON.stringify({ method: "ok" })}\n`);
    await tick();
    expect(notes).toEqual(["ok"]);
    expect(problems).toHaveLength(5);
  });

  test("closing rejects whatever is still waiting, and nothing more is sent", async () => {
    const p = peer();
    let closed = 0;
    const c = new JsonRpcConnection(p.transport, { onClose: () => closed++ });
    const r = c.request("turn/start", {});
    c.close();
    expect(await r.catch((e: unknown) => e)).toBeInstanceOf(JsonRpcClosedError);
    expect(p.closedByClient).toBe(true);
    await expect(c.request("model/list")).rejects.toBeInstanceOf(JsonRpcClosedError);
    c.notify("initialized");
    expect(p.sent).toHaveLength(1);
    await c.closed;
    expect(closed).toBe(1);
  });

  test("the peer going away rejects pending requests and closes the connection", async () => {
    const p = peer();
    const c = new JsonRpcConnection(p.transport);
    const r = c.request("turn/start", {});
    p.end();
    expect(await r.catch((e: unknown) => e)).toBeInstanceOf(JsonRpcClosedError);
    await c.closed;
    expect(c.isOpen).toBe(false);
  });

  test("a last message without its newline still counts when the peer ends", async () => {
    const p = peer();
    const c = new JsonRpcConnection(p.transport);
    const r = c.request("model/list", {});
    p.push(JSON.stringify({ id: 1, result: { data: [1] } }));
    p.end();
    expect(await r).toEqual({ data: [1] });
  });

  test("a request can time out", async () => {
    const p = peer();
    const c = new JsonRpcConnection(p.transport);
    await expect(c.request("account/read", {}, { timeoutMs: 5 })).rejects.toBeInstanceOf(
      JsonRpcTimeoutError,
    );
  });
});
