import type { GravitaEvent } from "@gravita/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowAttention } from "@/infrastructure/platform/attention";
import type {
  Notifier,
  NotifyPermission,
  OsNotification,
} from "@/infrastructure/platform/notifier";
import {
  createNotificationPrefs,
  type NotificationPrefsStore,
} from "@/infrastructure/preferences/notificationPrefs";
import { setLocale } from "@/shared/i18n/i18n";
import { syncWithEngine } from "@/state/engineSync";
import type { Route } from "@/state/slices/route";
import { createAppStore } from "@/state/store";
import { ev, NOW, started, stateOf } from "@/test/events";
import { FakeGateway } from "@/test/FakeGateway";
import { memoryStorage } from "@/test/render";
import { LINK_TTL_MS } from "./deepLink";
import { COALESCE_MS, startNotifications } from "./notificationService";

class FakeNotifier implements Notifier {
  shown: OsNotification[] = [];
  state: NotifyPermission = "granted";
  answer: NotifyPermission = "granted";
  requests = 0;
  async permission() {
    return this.state;
  }
  async requestPermission() {
    this.requests++;
    this.state = this.answer;
    return this.answer;
  }
  async notify(n: OsNotification) {
    this.shown.push(n);
  }
}

class FakeAttention implements WindowAttention {
  focused = false;
  private listeners = new Set<() => void>();
  attended() {
    return this.focused;
  }
  onAttend(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  /** The user comes back to the window. */
  back() {
    this.focused = true;
    for (const l of this.listeners) l();
  }
}

/** Fake timers own Date.now, setTimeout and microtasks' surroundings; flush awaits promises. */
const settle = () => vi.advanceTimersByTimeAsync(0);

function at(sessionId: string, agentId?: string) {
  return {
    ts: new Date(Date.now()).toISOString(),
    projectId: "p1",
    sessionId,
    ...(agentId ? { agentId } : {}),
  };
}

const control = (sessionId: string) =>
  ev(
    "session.control",
    { controllable: true },
    { ...at(sessionId), ts: new Date(NOW - 60_000).toISOString() },
  );

function setup(prefs: NotificationPrefsStore = createNotificationPrefs(memoryStorage)) {
  const gateway = new FakeGateway();
  const store = createAppStore(gateway, { now: NOW });
  const base = stateOf(started("s1", 5, "p1", "chat"), started("s2", 5, "p1", "chat"), [
    ev(
      "session.presence",
      { status: "busy" },
      { ...at("s1"), ts: new Date(NOW - 60_000).toISOString() },
    ),
    ev(
      "session.presence",
      { status: "busy" },
      { ...at("s2"), ts: new Date(NOW - 60_000).toISOString() },
    ),
    control("s1"),
    control("s2"),
  ]);
  store.getState().loadSnapshot({ seq: 1, state: base });
  const unsync = syncWithEngine(store, gateway);
  const notifier = new FakeNotifier();
  const attention = new FakeAttention();
  const navigate = vi.fn<(route: Route) => void>();
  const stop = startNotifications({ store, gateway, notifier, attention, prefs, navigate });
  const push = (...events: GravitaEvent[]) => gateway.emitEvents({ seq: 2, events });
  return { gateway, store, notifier, attention, navigate, push, stop, unsync };
}

const ask = (sessionId: string, agentId = "main", requestId = `${sessionId}:${agentId}`) =>
  ev(
    "permission.requested",
    { requestId, toolName: "Bash", inputPreview: "pnpm test" },
    at(sessionId, agentId),
  );
const answered = (sessionId: string, agentId = "main", requestId = `${sessionId}:${agentId}`) =>
  ev("permission.resolved", { requestId, decision: "allow", by: "user" }, at(sessionId, agentId));
const turn = (sessionId: string) => ev("turn.completed", { subtype: "success" }, at(sessionId));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  setLocale("en");
});
afterEach(() => vi.useRealTimers());

describe("notification service", () => {
  it("notifies a live event while the window is in the background", async () => {
    const { push, notifier } = setup();
    push(ask("s1"));
    await settle();
    expect(notifier.shown).toEqual([
      {
        title: "Main agent is waiting for your approval",
        body: "p1 › Untitled session · Bash · pnpm test",
      },
    ]);
  });

  it("stays quiet while you're looking at Gravita", async () => {
    const { push, notifier, attention } = setup();
    attention.focused = true;
    push(ask("s1"), turn("s2"));
    await settle();
    expect(notifier.shown).toEqual([]);
  });

  it("never notifies from a snapshot, however much waits in it", async () => {
    const { gateway, store, notifier } = setup();
    gateway.snapshotResult = {
      seq: 9,
      state: stateOf(started("s9", 1), [ask("s9")]),
    };
    gateway.emitConnection("online");
    await settle();
    expect(Object.keys(store.getState().projection.sessions)).toContain("s9");
    expect(notifier.shown).toEqual([]);
  });

  it("folds a burst into one notification per session per 5 s, with +N more", async () => {
    const { push, notifier } = setup();
    push(turn("s1"));
    await settle();
    push(ask("s1"));
    push(ev("agent.completed", { status: "failed" }, at("s1", "x")));
    push(turn("s2")); // another session: not held back
    await settle();
    expect(notifier.shown.map((n) => n.title)).toEqual([
      "Main agent finished",
      "Main agent finished",
    ]);

    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(notifier.shown).toHaveLength(3);
    // Waiting on you is the most pressing of what piled up.
    expect(notifier.shown[2]).toEqual({
      title: "Main agent is waiting for your approval",
      body: "p1 › Untitled session · Bash · pnpm test · +1 more",
    });
  });

  it("drops a folded notification that stopped mattering, or when you came back", async () => {
    const { push, notifier, attention } = setup();
    push(turn("s1"));
    await settle();
    push(ask("s1"));
    await settle();
    push(answered("s1"));
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(notifier.shown).toHaveLength(1);

    push(turn("s2"));
    await settle();
    push(turn("s2"));
    await settle();
    attention.back();
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    expect(notifier.shown).toHaveLength(2);
  });

  it("follows the preferences as they change", async () => {
    const prefs = createNotificationPrefs(memoryStorage);
    const { push, notifier } = setup(prefs);
    prefs.set({ finished: false });
    push(turn("s1"));
    await settle();
    expect(notifier.shown).toEqual([]);
    prefs.set({ finished: true });
    push(turn("s2"));
    await settle();
    expect(notifier.shown).toHaveLength(1);
  });

  it("asks the OS once, on the first notification, and stays quiet when told no", async () => {
    const { push, notifier } = setup();
    notifier.state = "default";
    notifier.answer = "denied";
    push(ask("s1"));
    await settle();
    await vi.advanceTimersByTimeAsync(COALESCE_MS);
    push(ask("s2"));
    await settle();
    expect(notifier.requests).toBe(1);
    expect(notifier.shown).toEqual([]);
  });

  it("asks once and notifies when allowed", async () => {
    const { push, notifier } = setup();
    notifier.state = "default";
    push(ask("s1"));
    await settle();
    expect(notifier.requests).toBe(1);
    expect(notifier.shown).toHaveLength(1);
  });

  it("stops listening when stopped", async () => {
    const { push, notifier, stop } = setup();
    stop();
    push(ask("s1"));
    await settle();
    expect(notifier.shown).toEqual([]);
  });
});

describe("deep link on return", () => {
  it("opens the waiting agent when you come back within 2 minutes", async () => {
    const { push, attention, navigate } = setup();
    push(
      ev(
        "agent.spawned",
        { parentAgentId: "main", agentType: "Explore", depth: 1, background: false },
        at("s1", "a"),
      ),
      ask("s1", "a"),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    attention.back();
    expect(navigate).toHaveBeenCalledWith({
      level: "session",
      projectId: "p1",
      sessionId: "s1",
      agentId: "a",
    });
  });

  it("follows it once only", async () => {
    const { push, attention, navigate } = setup();
    push(ask("s1"));
    await settle();
    attention.back();
    attention.focused = false;
    attention.back();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("forgets it after 2 minutes", async () => {
    const { push, attention, navigate } = setup();
    push(ask("s1"));
    await settle();
    await vi.advanceTimersByTimeAsync(LINK_TTL_MS + 1);
    attention.back();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("doesn't open an agent that is no longer waiting", async () => {
    const { push, attention, navigate } = setup();
    push(ask("s1"));
    await settle();
    attention.focused = true; // answered from the terminal: no notification, just state
    push(answered("s1"));
    await settle();
    attention.focused = false;
    attention.back();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("leads to the latest notification: a finished turn after a waiting agent", async () => {
    const { push, attention, navigate } = setup();
    push(ask("s1"));
    await settle();
    push(turn("s2"));
    await settle();
    attention.back();
    expect(navigate).toHaveBeenCalledWith({
      level: "session",
      projectId: "p1",
      sessionId: "s2",
      agentId: "main",
    });
  });

  it("has nothing to follow when the OS refused the notification", async () => {
    const { push, attention, navigate, notifier } = setup();
    notifier.state = "denied";
    push(ask("s1"));
    await settle();
    attention.back();
    expect(navigate).not.toHaveBeenCalled();
  });
});
