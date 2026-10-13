import { describe, expect, test } from "bun:test";
import { SqliteCheckpointStore } from "../../src/infrastructure/persistence/sqlite-checkpoint-store";
import { openDatabase } from "../../src/infrastructure/persistence/sqlite-database";
import { SqliteEventStore } from "../../src/infrastructure/persistence/sqlite-event-store";
import { event } from "../helpers";

describe("sqlite persistence", () => {
  test("session events come back in seq order and tail checkpoints round-trip", () => {
    const db = openDatabase(":memory:");
    const store = new SqliteEventStore(db);
    const tails = new SqliteCheckpointStore(db);
    store.insert(event({ key: "user:1", sessionId: "s1" }));
    store.insert(event({ key: "user:2", sessionId: "s2" }));
    store.insert(event({ key: "user:3", sessionId: "s1" }));
    expect(store.sessionEvents("s1").map((e) => e.key)).toEqual(["user:1", "user:3"]);

    expect(tails.load("s1")).toBeUndefined();
    tails.save("s1", { path: "/a.jsonl", projectId: "p", checkpoint: "{}" });
    tails.save("s1", { path: "/a.jsonl", projectId: "p", checkpoint: '{"x":1}' });
    expect(tails.load("s1")).toEqual({
      path: "/a.jsonl",
      projectId: "p",
      checkpoint: '{"x":1}',
    });
    db.close();
  });

  test("a checkpoint saved in the events' transaction rolls back with them", () => {
    const db = openDatabase(":memory:");
    const store = new SqliteEventStore(db);
    const tails = new SqliteCheckpointStore(db);
    expect(() =>
      store.transaction(() => {
        store.insert(event({ key: "user:1" }));
        tails.save("s1", { path: "/a.jsonl", projectId: "p", checkpoint: "{}" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.maxSeq()).toBe(0);
    expect(tails.load("s1")).toBeUndefined();
    db.close();
  });
});
