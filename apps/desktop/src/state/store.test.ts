import { describe, expect, it } from "vitest";
import { ago, ev, NOW, started, stateOf } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { syncWithEngine } from "./engineSync";
import type { Route } from "./slices/route";
import { createAppStore } from "./store";

function setup(route: Route = { level: "home" }) {
  const gateway = new FakeGateway();
  const store = createAppStore(gateway, { route, now: NOW });
  const unsync = syncWithEngine(store, gateway);
  return { gateway, store, unsync };
}

const twoProjects = () => stateOf(started("s1", 10, "p1"), started("s2", 10, "p2"));

describe("app store: projection", () => {
  it("loads the snapshot when the gateway comes online", async () => {
    const { gateway, store } = setup();
    gateway.snapshotResult = { seq: 4, state: twoProjects() };
    expect(store.getState().connection).toBe("connecting");

    gateway.emitConnection("online");
    await flush();

    expect(store.getState().connection).toBe("online");
    expect(Object.keys(store.getState().projection.sessions)).toEqual(["s1", "s2"]);
  });

  it("applies a batch with structural sharing", async () => {
    const { gateway, store } = setup();
    gateway.snapshotResult = { seq: 4, state: twoProjects() };
    gateway.emitConnection("online");
    await flush();
    const before = store.getState().projection;

    gateway.emitEvents({
      seq: 5,
      events: [ev("session.titled", { title: "Fix login" }, { projectId: "p1", sessionId: "s1" })],
    });
    const after = store.getState().projection;

    expect(after).not.toBe(before);
    expect(after.seq).toBe(5);
    // The touched session and its project are new objects…
    expect(after.sessions.s1).not.toBe(before.sessions.s1);
    expect(after.sessions.s1!.title).toBe("Fix login");
    expect(after.projects.p1).not.toBe(before.projects.p1);
    // …everything else keeps its identity, so precise selectors don't re-render.
    expect(after.sessions.s2).toBe(before.sessions.s2);
    expect(after.projects.p2).toBe(before.projects.p2);
    // The previous projection was never mutated.
    expect(before.sessions.s1!.title).toBeUndefined();
  });

  it("adds sessions that appear in a batch without touching the others", async () => {
    const { gateway, store } = setup();
    gateway.snapshotResult = { seq: 1, state: twoProjects() };
    gateway.emitConnection("online");
    await flush();
    const before = store.getState().projection;

    gateway.emitEvents({ seq: 2, events: started("s3", 0, "p1") });
    const after = store.getState().projection;

    expect(after.projects.p1!.sessionIds).toEqual(["s1", "s3"]);
    expect(before.projects.p1!.sessionIds).toEqual(["s1"]);
    expect(after.sessions.s1).toBe(before.sessions.s1);
  });

  it("drops the link to retry when the snapshot fails", async () => {
    const { gateway, store } = setup();
    gateway.snapshotResult = new Error("timeout");
    gateway.emitConnection("online");
    await flush();
    expect(gateway.reconnects).toBe(1);
    expect(store.getState().connection).toBe("connecting");
  });

  it("goes offline and takes engine status from the gateway", () => {
    const { gateway, store } = setup();
    gateway.emitStatus({
      providers: { claude: { found: true } },
      claude: { found: true },
      indexing: { done: 1, total: 1 },
      demo: true,
    });
    expect(store.getState().engineStatus?.demo).toBe(true);
    gateway.emitConnection("offline");
    expect(store.getState().connection).toBe("offline");
  });

  it("stops listening once unsynced", () => {
    const { gateway, store, unsync } = setup();
    unsync();
    gateway.emitConnection("offline");
    expect(store.getState().connection).toBe("connecting");
  });
});

describe("app store: open session", () => {
  const session = { level: "session", projectId: "p1", sessionId: "s1" } as const;
  const tool = (id: string, minutesAgo: number) =>
    ev(
      "tool.started",
      { toolUseId: id, name: "Read", kind: "read", target: { path: "a.ts" }, inputPreview: "" },
      { ts: ago(minutesAgo), projectId: "p1", sessionId: "s1" },
    );

  it("loads a routed session's events", async () => {
    const { gateway, store } = setup();
    const stored = [tool("t1", 3)];
    gateway.sessionEventsResult = { events: stored };

    store.getState().setRoute(session);
    expect(store.getState().openSession).toEqual({ id: "s1", events: [], loading: true });
    await flush();

    expect(gateway.sessionEventCalls).toEqual([{ sessionId: "s1" }]);
    expect(store.getState().openSession).toEqual({ id: "s1", events: stored, loading: false });
  });

  it("merges live events that arrived while loading, deduped by key", async () => {
    const { gateway, store } = setup();
    const t1 = tool("t1", 3);
    const t2 = tool("t2", 1);
    gateway.holdSessionEvents = true;
    gateway.sessionEventsResult = { events: [t1] };

    store.getState().setRoute(session);
    // t1 arrives live too (already persisted), t2 only live; another session is ignored.
    gateway.emitEvents({
      seq: 9,
      events: [t1, t2, ev("thinking", { messageId: "m" }, { projectId: "p1", sessionId: "s9" })],
    });
    gateway.releaseSessionEvents();
    await flush();

    expect(store.getState().openSession?.events.map((e) => e.key)).toEqual([t1.key, t2.key]);
  });

  it("refetches the routed session after a reconnect", async () => {
    const { gateway, store } = setup(session);
    store.getState().loadSession("s1");
    await flush();
    gateway.snapshotResult = { seq: 1, state: twoProjects() };
    gateway.emitConnection("online");
    await flush();
    expect(gateway.sessionEventCalls).toHaveLength(2);
  });
});

describe("app store: commands", () => {
  it("answers a permission request through the gateway", async () => {
    const { gateway, store } = setup();
    const params = { sessionId: "s1", agentId: "a", requestId: "r1", decision: "allow" } as const;
    await store.getState().respondPermission(params);
    expect(gateway.responded).toEqual([params]);
  });

  it("ticks the clock", () => {
    const { store } = setup();
    store.getState().tick(NOW + 1000);
    expect(store.getState().now).toBe(NOW + 1000);
  });
});
