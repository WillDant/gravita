import { describe, expect, test } from "bun:test";
import { EventBroadcaster, FLUSH_MS } from "../../src/application/services/event-broadcaster";
import { ProjectionService } from "../../src/application/services/projection-service";
import { InMemorySessionRuntimeRegistry } from "../../src/application/services/session-runtime-registry";
import { GetSessionEvents } from "../../src/application/usecases/get-session-events";
import { GetSnapshot } from "../../src/application/usecases/get-snapshot";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { RespondToPermission } from "../../src/application/usecases/respond-to-permission";
import { NotControllableError } from "../../src/domain/errors";
import {
  FakeClock,
  FakeRuntime,
  MemoryCheckpointStore,
  MemoryEventStore,
  RecordingPublisher,
} from "../fakes";
import { event } from "../helpers";

const STATUS = { claude: { found: false }, indexing: { done: 0, total: 0 }, demo: false };

function setup() {
  const store = new MemoryEventStore();
  const projection = new ProjectionService();
  const publisher = new RecordingPublisher();
  const ingest = new IngestEvents(store, projection, publisher);
  return { store, projection, publisher, ingest };
}

describe("IngestEvents", () => {
  test("stores each key once and publishes only what was new", () => {
    const { store, projection, publisher, ingest } = setup();
    const a = event({ key: "user:a" });
    const b = event({ key: "user:b" });
    expect(ingest.execute([a, b, a]).map((e) => e.key)).toEqual(["user:a", "user:b"]);
    expect(ingest.execute([a, b])).toEqual([]);
    expect(store.rows.map((e) => e.key)).toEqual(["user:a", "user:b"]);
    expect(projection.seq).toBe(2);
    expect(publisher.batches).toEqual([{ keys: ["user:a", "user:b"], seq: 2 }]);
  });

  test("ephemeral events are applied and published, never stored, and keep seq", () => {
    const { store, projection, publisher, ingest } = setup();
    ingest.execute([event({ key: "user:a" })]);
    const presence = event({
      key: "presence:1",
      type: "session.presence",
      data: { pid: 1, status: "busy" },
    });
    const control = event({
      key: "control:1",
      type: "session.control",
      data: { controllable: true },
    });
    expect(ingest.execute([presence, control, presence])).toHaveLength(3);
    expect(store.rows).toHaveLength(1);
    expect(projection.session("s1")).toMatchObject({ live: true, controllable: true });
    expect(publisher.batches.at(-1)).toEqual({
      keys: ["presence:1", "control:1", "presence:1"],
      seq: 1,
    });
  });

  test("the in-transaction callback runs inside the same transaction, after the inserts", () => {
    const { store, ingest } = setup();
    const checkpoints = new MemoryCheckpointStore(store);
    const saved = { path: "/s1.jsonl", projectId: "p1", checkpoint: "{}" };
    ingest.execute([event({ key: "user:a" })], () => checkpoints.save("s1", saved));
    expect(store.txLog).toEqual(["insert:user:a", "checkpoint:s1"]);
    expect(checkpoints.load("s1")).toEqual(saved);
  });

  test("a failing transaction applies and publishes nothing", () => {
    const { projection, publisher, ingest } = setup();
    expect(() =>
      ingest.execute([event({ key: "user:a" })], () => {
        throw new Error("disk full");
      }),
    ).toThrow("disk full");
    expect(projection.seq).toBe(0);
    expect(projection.session("s1")).toBeUndefined();
    expect(publisher.batches).toEqual([]);
  });
});

describe("ProjectionService", () => {
  test("snapshot and session queries are copies, never the live state", () => {
    const { projection, ingest } = setup();
    ingest.execute([event({ key: "user:a" })]);
    const snap = projection.snapshot();
    snap.state.sessions.s1!.title = "mutated";
    delete snap.state.sessions.s1;
    projection.session("s1")!.title = "also mutated";
    expect(projection.session("s1")!.title).toBeUndefined();
    expect(Object.keys(projection.snapshot().state.sessions)).toEqual(["s1"]);
    expect(projection.snapshot()).not.toBe(projection.snapshot());
  });

  test("hydrates from stored events", () => {
    const projection = new ProjectionService();
    projection.hydrate([event({ key: "user:a" }), event({ key: "user:b", sessionId: "s2" })], 7);
    expect(projection.seq).toBe(7);
    expect(Object.keys(projection.snapshot().state.sessions).sort()).toEqual(["s1", "s2"]);
  });
});

describe("EventBroadcaster", () => {
  test("batches events on the clock and skips an unchanged status", () => {
    const clock = new FakeClock();
    const b = new EventBroadcaster(clock, STATUS);
    const seen: string[] = [];
    b.listen({
      events: (n) => seen.push(`events:${n.events.length}@${n.seq}`),
      status: (s) => seen.push(`status:${s.indexing.done}`),
    });
    b.publish([event({ key: "a" })], 1);
    b.publish([event({ key: "b" })], 2);
    b.updateStatus({ indexing: { done: 0, total: 0 } });
    expect(seen).toEqual([]);
    clock.advance(FLUSH_MS);
    expect(seen).toEqual(["events:2@2"]);
    b.updateStatus({ indexing: { done: 1, total: 1 } });
    clock.advance(FLUSH_MS);
    expect(seen).toEqual(["events:2@2", "status:1"]);
    b.close();
    expect(clock.pendingTimers()).toBe(0);
  });

  test("GetSnapshot flushes pending batches before copying the state", () => {
    const clock = new FakeClock();
    const store = new MemoryEventStore();
    const projection = new ProjectionService();
    const broadcaster = new EventBroadcaster(clock, STATUS);
    const ingest = new IngestEvents(store, projection, broadcaster);
    const seen: string[][] = [];
    broadcaster.listen({ events: (n) => seen.push(n.events.map((e) => e.key)) });
    ingest.execute([event({ key: "user:a" })]);
    const snap = new GetSnapshot(broadcaster, projection).execute();
    expect(seen).toEqual([["user:a"]]);
    expect(snap.seq).toBe(1);
    expect(new GetSessionEvents(store).execute("s1").events.map((e) => e.key)).toEqual(["user:a"]);
  });
});

describe("RespondToPermission", () => {
  const params = {
    sessionId: "s1",
    agentId: "main",
    requestId: "r1",
    decision: "allow" as const,
  };

  test("answers through the session's runtime", async () => {
    const { ingest } = setup();
    const runtimes = new InMemorySessionRuntimeRegistry(ingest, new FakeClock());
    const runtime = new FakeRuntime("s1");
    runtimes.register(runtime);
    expect(await new RespondToPermission(runtimes).execute(params)).toEqual({ ok: true });
    expect(runtime.answered).toEqual([{ agentId: "main", requestId: "r1", decision: "allow" }]);
  });

  test("a session without a runtime is not controllable", async () => {
    const { ingest } = setup();
    const runtimes = new InMemorySessionRuntimeRegistry(ingest, new FakeClock());
    runtimes.register(new FakeRuntime("other"));
    const err = await new RespondToPermission(runtimes).execute(params).catch((e) => e);
    expect(err).toBeInstanceOf(NotControllableError);
  });
});

describe("SessionRuntimeRegistry", () => {
  test("register and unregister announce session.control and drive ownership", () => {
    const { projection, publisher, ingest } = setup();
    const runtimes = new InMemorySessionRuntimeRegistry(ingest, new FakeClock());
    const runtime = new FakeRuntime("s1");
    runtimes.register(runtime);
    expect(runtimes.get("s1")).toBe(runtime);
    expect(runtimes.isOwned("s1")).toBe(true);
    expect(projection.session("s1")!.controllable).toBe(true);

    runtimes.unregister("s1");
    runtimes.unregister("s1");
    expect(runtimes.all()).toEqual([]);
    expect(runtimes.isOwned("s1")).toBe(false);
    expect(projection.session("s1")!.controllable).toBe(false);
    expect(
      publisher.batches.map((b) => b.keys.map((k) => k.split(":").slice(0, 3).join(":"))),
    ).toEqual([["control:s1:true"], ["control:s1:false"]]);
  });
});
