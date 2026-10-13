import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SessionState } from "@gravita/core";
import type { EventsNotification } from "@gravita/protocol";
import { GetSnapshot } from "../../src/application/usecases/get-snapshot";
import { createCore } from "../../src/main/container";
import { event, withTempDir } from "../helpers";

// The real pipeline (SQLite store → projection → broadcaster), as the engine wires it.

describe("store + projection + broadcaster", () => {
  test("a key is stored once; only new events are applied and broadcast", () => {
    const core = createCore({ dbPath: ":memory:", demo: false });
    const batches: EventsNotification[] = [];
    core.broadcaster.listen({ events: (n) => batches.push(n) });

    const a = event({ key: "user:a" });
    const b = event({ key: "user:b" });
    expect(core.ingest.execute([a, b]).map((e) => e.key)).toEqual(["user:a", "user:b"]);
    expect(core.ingest.execute([a, b, a])).toEqual([]);
    expect(core.events.maxSeq()).toBe(2);
    expect(core.projection.seq).toBe(2);

    core.broadcaster.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.events.map((e) => e.key)).toEqual(["user:a", "user:b"]);
    expect(batches[0]!.seq).toBe(2);
    core.close();
  });

  test("ephemeral events are applied and broadcast but never stored", () => {
    const core = createCore({ dbPath: ":memory:", demo: false });
    const presence = event({
      key: "presence:1",
      type: "session.presence",
      data: { pid: 1, status: "busy" },
    });
    expect(core.ingest.execute([presence])).toHaveLength(1);
    expect(core.projection.session("s1")!.live).toBe(true);
    expect(core.events.maxSeq()).toBe(0);
    expect(core.events.sessionEvents("s1")).toEqual([]);
    core.close();
  });

  test("the projection is rebuilt from stored events on restart", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "gravita.db");
      const first = createCore({ dbPath: path, demo: false });
      first.ingest.execute([
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
      const before = first.projection.snapshot().state;
      first.close();

      const second = createCore({ dbPath: path, demo: false });
      const after = second.projection.snapshot().state;
      expect(after.seq).toBe(2);
      expect(after.sessions.s1!.agents.main!.toolCount).toBe(1);
      // Presence was ephemeral: everything else matches.
      const rebuilt: SessionState = {
        ...after.sessions.s1!,
        live: true,
        presence: "busy",
        version: 0,
      };
      expect(rebuilt).toEqual({ ...before.sessions.s1!, version: 0 });
      second.close();
    });
  });

  test("a snapshot flushes pending batches first, so nothing is applied twice", () => {
    const core = createCore({ dbPath: ":memory:", demo: false });
    const getSnapshot = new GetSnapshot(core.broadcaster, core.projection);
    const early: EventsNotification[] = [];
    core.broadcaster.listen({ events: (n) => early.push(n) });
    core.ingest.execute([event({ key: "user:a" })]);
    const snap = getSnapshot.execute();
    expect(early.map((n) => n.events.length)).toEqual([1]);
    expect(snap.seq).toBe(1);

    const late: EventsNotification[] = [];
    core.broadcaster.listen({ events: (n) => late.push(n) });
    core.ingest.execute([event({ key: "user:b" })]);
    core.broadcaster.flush();
    expect(late.flatMap((n) => n.events.map((e) => e.key))).toEqual(["user:b"]);
    core.close();
  });
});
