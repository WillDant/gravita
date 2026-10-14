import { RpcErrors } from "@gravita/protocol/constants";
import { describe, expect, it } from "vitest";
import { GatewayError } from "@/infrastructure/engine/GatewayError";
import { NOW } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { createAppStore } from "../store";

function setup() {
  const gateway = new FakeGateway();
  const store = createAppStore(gateway, { now: NOW });
  return { gateway, store };
}

const err = (e: { code: number; message: string }) => new GatewayError(e.code, e.message);

describe("control slice", () => {
  it("starts a session and remembers it until the projection has it", async () => {
    const { gateway, store } = setup();
    gateway.startResult = { sessionId: "s9", projectId: "p9" };

    const r = await store.getState().startSession({ cwd: "/work/app", prompt: "Fix the login" });

    expect(r).toEqual({ ok: true, value: { sessionId: "s9", projectId: "p9" } });
    expect(gateway.callsOf("startSession")).toEqual([
      { cwd: "/work/app", prompt: "Fix the login" },
    ]);
    expect(store.getState().startingSessionId).toBe("s9");
  });

  it("returns the engine's error with its code instead of throwing", async () => {
    const { gateway, store } = setup();
    gateway.failures.startSession = err(RpcErrors.tooManySessions);

    const r = await store.getState().startSession({ cwd: "/w", prompt: "x" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(4007);
    expect(store.getState().startingSessionId).toBeUndefined();
  });

  it("turns plain failures into an offline GatewayError", async () => {
    const { gateway, store } = setup();
    gateway.sendMessage = async () => {
      throw new Error("not connected");
    };
    const r = await store.getState().sendMessage("s", "hi");
    expect(r).toMatchObject({ ok: false, error: { code: -1 } });
  });

  it("sends each command with the right params", async () => {
    const { gateway, store } = setup();
    const s = store.getState();
    const results = await Promise.all([
      s.sendMessage("s", "hello"),
      s.interrupt("s"),
      s.stopAgent("s", "a1"),
      s.setModel("s", "opus"),
      s.setPermissionMode("s", "plan"),
      s.answerQuestion({ sessionId: "s", agentId: "a", requestId: "r", answers: { Q: "A" } }),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(gateway.calls).toEqual([
      { method: "sendMessage", params: { sessionId: "s", text: "hello" } },
      { method: "interruptSession", params: { sessionId: "s" } },
      { method: "stopAgent", params: { sessionId: "s", agentId: "a1" } },
      { method: "setModel", params: { sessionId: "s", model: "opus" } },
      { method: "setPermissionMode", params: { sessionId: "s", mode: "plan" } },
      {
        method: "answerQuestion",
        params: { sessionId: "s", agentId: "a", requestId: "r", answers: { Q: "A" } },
      },
    ]);
  });

  it("loads the models once, and retries only after a failure", async () => {
    const { gateway, store } = setup();
    gateway.failures.models = err({ code: -2, message: "timeout" });
    store.getState().loadModels();
    await flush();
    expect(store.getState().modelsStatus.claude).toBe("failed");

    delete gateway.failures.models;
    store.getState().loadModels();
    store.getState().loadModels();
    await flush();
    store.getState().loadModels();

    expect(gateway.callsOf("models")).toHaveLength(2);
    expect(gateway.callsOf("models")[0]).toEqual({ provider: "claude" });
    expect(store.getState().modelsStatus.claude).toBe("ready");
    expect(store.getState().models.claude?.map((m) => m.value)).toEqual(["default", "opus"]);
  });
});
