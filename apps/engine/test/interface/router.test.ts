import { describe, expect, test } from "bun:test";
import { RpcErrors } from "@gravita/protocol";
import { EventBroadcaster } from "../../src/application/services/event-broadcaster";
import { ProjectionService } from "../../src/application/services/projection-service";
import { InMemorySessionRuntimeRegistry } from "../../src/application/services/session-runtime-registry";
import { GetEngineStatus } from "../../src/application/usecases/get-engine-status";
import { GetSessionEvents } from "../../src/application/usecases/get-session-events";
import { GetSnapshot } from "../../src/application/usecases/get-snapshot";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { RespondToPermission } from "../../src/application/usecases/respond-to-permission";
import { createRouter, INTERNAL_ERROR, rpcHandlers } from "../../src/interface/rpc/router";
import { FakeClock, FakeRuntime, MemoryEventStore, SilentLogger } from "../fakes";
import { event } from "../helpers";

function setup() {
  const clock = new FakeClock();
  const store = new MemoryEventStore();
  const projection = new ProjectionService();
  const broadcaster = new EventBroadcaster(clock, {
    claude: { found: true, path: "/bin/claude" },
    indexing: { done: 0, total: 0 },
    demo: true,
  });
  const ingest = new IngestEvents(store, projection, broadcaster);
  const runtimes = new InMemorySessionRuntimeRegistry(ingest, clock);
  const logger = new SilentLogger();
  const handlers = rpcHandlers({
    getSnapshot: new GetSnapshot(broadcaster, projection),
    getEngineStatus: new GetEngineStatus(broadcaster),
    getSessionEvents: new GetSessionEvents(store),
    respondToPermission: new RespondToPermission(runtimes),
  });
  return { ingest, runtimes, logger, handlers, router: createRouter(handlers, logger) };
}

const perm = { sessionId: "s1", agentId: "main", requestId: "r1", decision: "deny" };

describe("rpc router (no network)", () => {
  test("routes reads to their use cases", async () => {
    const { ingest, router } = setup();
    ingest.execute([event({ key: "user:a" })]);
    const snap = await router.dispatch("state.snapshot", {});
    expect(snap).toMatchObject({ result: { seq: 1 } });
    expect(await router.dispatch("state.snapshot", undefined)).toMatchObject({
      result: { seq: 1 },
    });
    expect(await router.dispatch("engine.status", undefined)).toEqual({
      result: {
        claude: { found: true, path: "/bin/claude" },
        indexing: { done: 0, total: 0 },
        demo: true,
      },
    });
    const events = await router.dispatch("session.events", { sessionId: "s1" });
    expect("result" in events && (events.result as { events: unknown[] }).events).toHaveLength(1);
  });

  test("invalid params are a bad request; unknown methods are not found", async () => {
    const { router } = setup();
    expect(await router.dispatch("session.events", {})).toEqual({ error: RpcErrors.badRequest });
    expect(await router.dispatch("session.events", { sessionId: 1 })).toEqual({
      error: RpcErrors.badRequest,
    });
    expect(await router.dispatch("permission.respond", { ...perm, decision: "maybe" })).toEqual({
      error: RpcErrors.badRequest,
    });
    expect(await router.dispatch("engine.status", "nope")).toEqual({
      error: RpcErrors.badRequest,
    });
    for (const method of ["nope", "toString", "__proto__", "auth"]) {
      expect(await router.dispatch(method, {})).toEqual({ error: RpcErrors.methodNotFound });
    }
  });

  test("permission.respond reaches the session's runtime, or is not controllable", async () => {
    const { runtimes, router } = setup();
    expect(await router.dispatch("permission.respond", perm)).toEqual({
      error: RpcErrors.notControllable,
    });
    const runtime = new FakeRuntime("s1");
    runtimes.register(runtime);
    expect(await router.dispatch("permission.respond", perm)).toEqual({ result: { ok: true } });
    expect(runtime.answered).toEqual([{ agentId: "main", requestId: "r1", decision: "deny" }]);
  });

  test("an unexpected failure is an internal error and is logged", async () => {
    const { handlers, logger } = setup();
    const router = createRouter(
      {
        ...handlers,
        "engine.status": () => {
          throw new Error("boom");
        },
      },
      logger,
    );
    expect(await router.dispatch("engine.status", {})).toEqual({ error: INTERNAL_ERROR });
    expect(logger.lines).toEqual(["engine.status failed"]);
  });
});
