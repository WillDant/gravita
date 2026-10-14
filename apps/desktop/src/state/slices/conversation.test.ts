import type { ConversationMessage } from "@gravita/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayError } from "@/infrastructure/engine/GatewayError";
import { ev, NOW } from "@/test/events";
import { FakeGateway } from "@/test/FakeGateway";
import { createAppStore } from "../store";
import { CONVERSATION_REFRESH_MS, dedupeMessages, hasArrived } from "./conversation";

const msg = (uuid: string, text: string, role: "user" | "assistant" = "assistant") =>
  ({ uuid, role, ts: "2026-10-12T12:00:00.000Z", text }) satisfies ConversationMessage;

const at = (sessionId: string) => ({ projectId: "p1", sessionId });

function setup() {
  const gateway = new FakeGateway();
  const store = createAppStore(gateway, { now: NOW });
  return { gateway, store };
}

/** Lets the fake's resolved promises settle under fake timers. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("conversation slice", () => {
  it("matches a sent message to the transcript's copy by text, not an older one", () => {
    const pending = { sessionId: "s1", text: "hi", ts: "2026-10-12T12:00:00.000Z" };
    expect(hasArrived([msg("u1", " hi ", "user")], pending)).toBe(true);
    expect(hasArrived([msg("a1", "hi")], pending)).toBe(false);
    expect(
      hasArrived([{ ...msg("u0", "hi", "user"), ts: "2026-10-12T11:00:00.000Z" }], pending),
    ).toBe(false);
  });

  it("drops the sent message when sending fails", async () => {
    const { gateway, store } = setup();
    gateway.failures.sendMessage = new GatewayError(1, "nope");
    const sent = store.getState().sendMessage("s1", "hi");
    expect(store.getState().pendingMessage?.text).toBe("hi");
    await settle();
    await sent;
    expect(store.getState().pendingMessage).toBeUndefined();
  });

  it("dedupes by uuid, keeping first position and latest text", () => {
    expect(dedupeMessages([msg("a", "1"), msg("b", "2"), msg("a", "1+")])).toEqual([
      msg("a", "1+"),
      msg("b", "2"),
    ]);
  });

  it("loads when opened, deduped", async () => {
    const { gateway, store } = setup();
    gateway.conversationResult = { messages: [msg("u1", "hi", "user"), msg("u1", "hi", "user")] };

    store.getState().openConversation("s1");
    expect(store.getState().conversation).toEqual({
      sessionId: "s1",
      messages: [],
      status: "loading",
    });
    await settle();

    expect(gateway.callsOf("conversation")).toEqual([{ sessionId: "s1" }]);
    expect(store.getState().conversation?.messages).toEqual([msg("u1", "hi", "user")]);
    expect(store.getState().conversation?.status).toBe("ready");
  });

  it("refreshes once, debounced, when new messages of that session arrive", async () => {
    const { gateway, store } = setup();
    store.getState().openConversation("s1");
    await settle();
    gateway.conversationResult = { messages: [msg("a1", "Done.")] };

    const batch = (events: ReturnType<typeof ev>[]) =>
      store.getState().applyBatch({ seq: 1, events });
    batch([ev("message.assistant", { messageId: "m1", textPreview: "Do" }, at("s1"))]);
    batch([ev("turn.completed", {}, at("s1"))]);
    batch([ev("message.user", { uuid: "x", textPreview: "x", origin: "human" }, at("s2"))]);
    batch([ev("thinking", { messageId: "m2" }, at("s1"))]);

    await vi.advanceTimersByTimeAsync(CONVERSATION_REFRESH_MS - 1);
    expect(gateway.callsOf("conversation")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(gateway.callsOf("conversation")).toHaveLength(2);
    expect(store.getState().conversation?.messages).toEqual([msg("a1", "Done.")]);
  });

  it("ignores answers that come back after it was closed", async () => {
    const { gateway, store } = setup();
    gateway.held.add("conversation");
    store.getState().openConversation("s1");
    store.getState().closeConversation("s1");
    gateway.release();
    await settle();
    expect(store.getState().conversation).toBeUndefined();
  });

  it("shows a failure only when there is nothing to show, and recovers on retry", async () => {
    const { gateway, store } = setup();
    gateway.failures.conversation = new GatewayError(-2, "timeout");
    store.getState().openConversation("s1");
    await settle();
    expect(store.getState().conversation?.status).toBe("failed");

    delete gateway.failures.conversation;
    gateway.conversationResult = { messages: [msg("a", "ok")] };
    store.getState().refreshConversation();
    await settle();
    expect(store.getState().conversation?.status).toBe("ready");
  });
});
