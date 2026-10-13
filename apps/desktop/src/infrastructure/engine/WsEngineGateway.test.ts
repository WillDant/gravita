import { RpcErrors } from "@gravita/protocol/constants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush } from "@/test/FakeGateway";
import { GatewayError, LocalErrors } from "./GatewayError";
import { WsEngineGateway } from "./WsEngineGateway";

/** A WebSocket stand-in: the test plays the engine by answering what the UI sends. */
class FakeSocket {
  static readonly OPEN = 1;
  static last?: FakeSocket;
  readyState = 0;
  sent: { id: number; method: string; params: unknown }[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (msg: { data: string }) => void;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  reply(id: number, body: { result?: unknown; error?: { code: number; message: string } }) {
    this.onmessage?.({ data: JSON.stringify({ jsonrpc: "2.0", id, ...body }) });
  }
  lastCall(method: string) {
    return this.sent.filter((m) => m.method === method).at(-1)!;
  }
}

async function online(): Promise<{ gw: WsEngineGateway; ws: FakeSocket }> {
  const gw = new WsEngineGateway(async () => ({ url: "ws://127.0.0.1:1/ws", token: "t" }));
  gw.connect();
  await flush();
  const ws = FakeSocket.last!;
  ws.open();
  ws.reply(ws.lastCall("auth").id, { result: { ok: true, engineVersion: "0" } });
  await flush();
  return { gw, ws };
}

beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
afterEach(() => vi.unstubAllGlobals());

describe("WsEngineGateway errors", () => {
  it("rejects with the engine's JSON-RPC code", async () => {
    const { gw, ws } = await online();
    const call = gw.startSession({ cwd: "/nope", prompt: "hi" });
    const req = ws.lastCall("session.start");
    expect(req.params).toEqual({ cwd: "/nope", prompt: "hi" });
    ws.reply(req.id, { error: RpcErrors.invalidCwd });

    const error = await call.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ code: 4006, message: "That folder doesn't exist" });
    gw.close();
  });

  it("resolves results of the new methods", async () => {
    const { gw, ws } = await online();
    const models = gw.models();
    ws.reply(ws.lastCall("claude.models").id, {
      result: { models: [{ value: "opus", displayName: "Opus" }] },
    });
    await expect(models).resolves.toEqual({ models: [{ value: "opus", displayName: "Opus" }] });

    const sent = gw.answerQuestion({
      sessionId: "s",
      agentId: "main",
      requestId: "r",
      answers: { "Which?": "A" },
    });
    ws.reply(ws.lastCall("question.answer").id, { result: { ok: true } });
    await expect(sent).resolves.toEqual({ ok: true });
    gw.close();
  });

  it("uses a local code when the link is down or drops mid-call", async () => {
    const offline = new WsEngineGateway(async () => ({ url: "ws://x", token: "t" }));
    await expect(offline.sendMessage({ sessionId: "s", text: "hi" })).rejects.toMatchObject({
      code: LocalErrors.offline,
    });

    const { gw, ws } = await online();
    const call = gw.interruptSession({ sessionId: "s" });
    ws.close();
    await expect(call).rejects.toMatchObject({ code: LocalErrors.offline });
    gw.close();
  });
});
