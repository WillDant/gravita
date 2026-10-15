import { describe, expect, test } from "bun:test";
import { keys } from "@gravita/protocol/ids";
import { RemoveSession } from "../../src/application/usecases/remove-session";
import { InMemorySessionRuntimeRegistry } from "../../src/application/services/session-runtime-registry";
import { ProjectionService } from "../../src/application/services/projection-service";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { EventBroadcaster } from "../../src/application/services/event-broadcaster";
import { SqliteEventStore } from "../../src/infrastructure/persistence/sqlite-event-store";
import { openDatabase } from "../../src/infrastructure/persistence/sqlite-database";
import { FakeClock } from "../fakes";
import type { SessionRuntime } from "../../src/application/ports/session-runtime";

const SID = "s-remove-1";
const PID = "p1";

function sessionStarted() {
  return {
    key: keys.sessionStarted(SID),
    ts: "2026-10-12T10:00:00.000Z",
    source: "gravita" as const,
    provider: "claude" as const,
    projectId: PID,
    sessionId: SID,
    type: "session.started" as const,
    data: { kind: "chat" as const, cwd: "/work", permissionMode: "default" },
  };
}

describe("RemoveSession", () => {
  test("ingests ended + removed and disposes a live runtime", async () => {
    const clock = new FakeClock();
    const db = openDatabase(":memory:");
    const store = new SqliteEventStore(db);
    const projection = new ProjectionService();
    const broadcaster = new EventBroadcaster(clock, {
      providers: { claude: { found: true } },
      indexing: { done: 0, total: 0 },
      demo: false,
    });
    const ingest = new IngestEvents(store, projection, broadcaster);
    projection.hydrate([sessionStarted()], 1);
    const runtimes = new InMemorySessionRuntimeRegistry(ingest, clock);
    let disposed = false;
    const runtime: SessionRuntime = {
      sessionId: SID,
      projectId: PID,
      provider: "claude",
      dispose: async () => {
        disposed = true;
      },
      respondPermission: async () => {},
      interrupt: async () => {},
      send: async () => {},
      stopAgent: async () => {},
      setModel: async () => {},
      setPermissionMode: async () => {},
      answerQuestion: async () => {},
    };
    runtimes.register(runtime);

    const remove = new RemoveSession(runtimes, projection, ingest, clock);
    expect(await remove.execute({ sessionId: SID })).toEqual({ ok: true });
    expect(disposed).toBe(true);
    expect(projection.session(SID)?.removed).toBe(true);
    expect([...store.allEvents()].map((e) => e.type)).toEqual(["session.ended", "session.removed"]);
  });

  test("only removed when the session already ended", async () => {
    const clock = new FakeClock();
    const db = openDatabase(":memory:");
    const store = new SqliteEventStore(db);
    const projection = new ProjectionService();
    const broadcaster = new EventBroadcaster(clock, {
      providers: { claude: { found: true } },
      indexing: { done: 0, total: 0 },
      demo: false,
    });
    const ingest = new IngestEvents(store, projection, broadcaster);
    projection.hydrate(
      [
        sessionStarted(),
        {
          key: keys.sessionEnded(SID),
          ts: "2026-10-12T11:00:00.000Z",
          source: "gravita",
          provider: "claude",
          projectId: PID,
          sessionId: SID,
          type: "session.ended",
          data: { reason: "exit" },
        },
      ],
      2,
    );
    const runtimes = new InMemorySessionRuntimeRegistry(ingest, clock);
    const remove = new RemoveSession(runtimes, projection, ingest, clock);
    await remove.execute({ sessionId: SID });
    expect([...store.allEvents()].map((e) => e.type)).toEqual(["session.removed"]);
  });
});
