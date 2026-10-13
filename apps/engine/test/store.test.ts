import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SessionState } from "@gravita/core";
import type { EventsNotification } from "@gravita/protocol";
import { Hub } from "../src/hub";
import { Store } from "../src/store";
import { event, withTempDir } from "./helpers";

describe("store + hub", () => {
  test("a key is stored once; only new events are applied and broadcast", () => {
    const hub = new Hub(new Store(":memory:"), { demo: false });
    const batches: EventsNotification[] = [];
    hub.listen({ events: (n) => batches.push(n) });

    const a = event({ key: "user:a" });
    const b = event({ key: "user:b" });
    expect(hub.ingest([a, b]).map((e) => e.key)).toEqual(["user:a", "user:b"]);
    expect(hub.ingest([a, b, a])).toEqual([]);
    expect(hub.store.maxSeq()).toBe(2);
    expect(hub.state.seq).toBe(2);

    hub.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.events.map((e) => e.key)).toEqual(["user:a", "user:b"]);
    expect(batches[0]!.seq).toBe(2);
    hub.close();
  });

  test("ephemeral events are applied and broadcast but never stored", () => {
    const hub = new Hub(new Store(":memory:"), { demo: false });
    const presence = event({
      key: "presence:1",
      type: "session.presence",
      data: { pid: 1, status: "busy" },
    });
    expect(hub.ingest([presence])).toHaveLength(1);
    expect(hub.state.sessions.s1!.live).toBe(true);
    expect(hub.store.maxSeq()).toBe(0);
    expect(hub.store.sessionEvents("s1")).toEqual([]);
    hub.close();
  });

  test("the projection is rebuilt from stored events on restart", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "gravita.db");
      const first = new Hub(new Store(path), { demo: false });
      first.ingest([
        event({ key: "user:a" }),
        event({
          key: "tool:t1:started",
          type: "tool.started",
          data: {
            toolUseId: "t1",
            name: "Read",
            kind: "read",
            target: { path: "/x" },
            inputPreview: "/x",
          },
        }),
        event({ key: "presence:1", type: "session.presence", data: { pid: 1, status: "busy" } }),
      ]);
      const before = structuredClone(first.state);
      first.store.close();

      const second = new Hub(new Store(path), { demo: false });
      expect(second.state.seq).toBe(2);
      expect(second.state.sessions.s1!.agents.main!.toolCount).toBe(1);
      // Presence was ephemeral: everything else matches.
      const rebuilt: SessionState = {
        ...second.state.sessions.s1!,
        live: true,
        presence: "busy",
        version: 0,
      };
      expect(rebuilt).toEqual({ ...before.sessions.s1!, version: 0 });
      second.store.close();
    });
  });

  test("session events come back in seq order and tail checkpoints round-trip", () => {
    const store = new Store(":memory:");
    store.insert(event({ key: "user:1", sessionId: "s1" }));
    store.insert(event({ key: "user:2", sessionId: "s2" }));
    store.insert(event({ key: "user:3", sessionId: "s1" }));
    expect(store.sessionEvents("s1").map((e) => e.key)).toEqual(["user:1", "user:3"]);

    expect(store.loadTail("s1")).toBeUndefined();
    store.saveTail("s1", { path: "/a.jsonl", projectId: "p", checkpoint: "{}" });
    store.saveTail("s1", { path: "/a.jsonl", projectId: "p", checkpoint: '{"x":1}' });
    expect(store.loadTail("s1")).toEqual({
      path: "/a.jsonl",
      projectId: "p",
      checkpoint: '{"x":1}',
    });
    store.close();
  });

  test("a snapshot flushes pending batches first, so nothing is applied twice", () => {
    const hub = new Hub(new Store(":memory:"), { demo: false });
    const early: EventsNotification[] = [];
    hub.listen({ events: (n) => early.push(n) });
    hub.ingest([event({ key: "user:a" })]);
    const snap = hub.snapshot();
    expect(early.map((n) => n.events.length)).toEqual([1]);
    expect(snap.seq).toBe(1);

    const late: EventsNotification[] = [];
    hub.listen({ events: (n) => late.push(n) });
    hub.ingest([event({ key: "user:b" })]);
    hub.flush();
    expect(late.flatMap((n) => n.events.map((e) => e.key))).toEqual(["user:b"]);
    hub.close();
  });
});
