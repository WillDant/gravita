import { describe, expect, test } from "bun:test";
import { RpcErrors } from "@gravita/protocol";
import { EventBroadcaster } from "../../src/application/services/event-broadcaster";
import { ProjectionService } from "../../src/application/services/projection-service";
import { InMemorySessionRuntimeRegistry } from "../../src/application/services/session-runtime-registry";
import { SessionSettingsRecorder } from "../../src/application/services/session-settings";
import { AnnounceProject } from "../../src/application/usecases/announce-project";
import { AnswerQuestion } from "../../src/application/usecases/answer-question";
import { GetConversation } from "../../src/application/usecases/get-conversation";
import { GetEngineStatus } from "../../src/application/usecases/get-engine-status";
import { GetSessionEvents } from "../../src/application/usecases/get-session-events";
import { GetSnapshot } from "../../src/application/usecases/get-snapshot";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { InterruptSession } from "../../src/application/usecases/interrupt-session";
import { FALLBACK_MODELS, ListModels } from "../../src/application/usecases/list-models";
import { RespondToPermission } from "../../src/application/usecases/respond-to-permission";
import { SendMessage } from "../../src/application/usecases/send-message";
import { SetModel } from "../../src/application/usecases/set-model";
import { SetPermissionMode } from "../../src/application/usecases/set-permission-mode";
import { StartChat } from "../../src/application/usecases/start-chat";
import { StopAgent } from "../../src/application/usecases/stop-agent";
import { StopAllSessions } from "../../src/application/usecases/stop-all-sessions";
import {
  ClaudeUnavailableError,
  InvalidAnswerError,
  NotLoggedInError,
} from "../../src/domain/errors";
import { createRouter, INTERNAL_ERROR, rpcHandlers } from "../../src/interface/rpc/router";
import {
  FakeChatFactory,
  FakeClaudeEnvironment,
  FakeClock,
  FakeRuntime,
  FakeTranscriptReader,
  FakeWorkspace,
  MemoryEventStore,
  SeqIds,
  SilentLogger,
} from "../fakes";
import { event } from "../helpers";

const SID = "11111111-1111-4111-8111-111111111111";

function setup(opts: { chat?: boolean } = {}) {
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
  const ids = new SeqIds();
  const settings = new SessionSettingsRecorder(ingest, clock);
  const environment = new FakeClaudeEnvironment();
  const factory = new FakeChatFactory(runtimes);
  const startChat = new StartChat({
    workspace: new FakeWorkspace(),
    claude: environment,
    factory,
    runtimes,
    projects: new AnnounceProject(
      { resolve: async (cwd) => ({ id: "p1", root: cwd, name: "demo" }) },
      ingest,
      clock,
    ),
    ingest,
    settings,
    ids,
    clock,
  });
  const handlers = rpcHandlers({
    getSnapshot: new GetSnapshot(broadcaster, projection),
    getEngineStatus: new GetEngineStatus(broadcaster),
    getSessionEvents: new GetSessionEvents(store),
    respondToPermission: new RespondToPermission(runtimes),
    ...(opts.chat === false ? {} : { startChat }),
    sendMessage: new SendMessage(runtimes, ingest, ids, clock),
    interruptSession: new InterruptSession(runtimes),
    stopAgent: new StopAgent(runtimes),
    setModel: new SetModel(runtimes, settings),
    setPermissionMode: new SetPermissionMode(runtimes, settings),
    answerQuestion: new AnswerQuestion(runtimes),
    getConversation: new GetConversation(
      new FakeTranscriptReader({
        [SID]: [{ uuid: "u1", role: "user", ts: "2026-10-12T10:00:00.000Z", text: "hi" }],
      }),
    ),
    listModels: new ListModels(runtimes, clock, logger),
    stopAll: new StopAllSessions(runtimes, clock, logger, 3_000),
  });
  return {
    store,
    ingest,
    runtimes,
    logger,
    handlers,
    environment,
    factory,
    router: createRouter(handlers, logger),
  };
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

describe("rpc router: session control", () => {
  test("session.start starts a chat; its errors map to their codes", async () => {
    const { router, environment, factory } = setup();
    const start = { cwd: "/work/demo", prompt: "Map the repo", permissionMode: "plan" };
    expect(await router.dispatch("session.start", start)).toEqual({
      result: { sessionId: "id-1", projectId: "p1" },
    });
    expect(factory.created[0]?.sent).toEqual([{ text: "Map the repo", uuid: "id-2" }]);

    expect(await router.dispatch("session.start", { ...start, cwd: "/nope" })).toEqual({
      error: RpcErrors.invalidCwd,
    });
    environment.result = new ClaudeUnavailableError("outdated");
    expect(await router.dispatch("session.start", start)).toEqual({
      error: RpcErrors.claudeUnavailable,
    });
    expect(await router.dispatch("session.start", { ...start, prompt: "" })).toEqual({
      error: RpcErrors.badRequest,
    });
    expect(await router.dispatch("session.start", { ...start, permissionMode: "yolo" })).toEqual({
      error: RpcErrors.badRequest,
    });
    expect(
      await router.dispatch("session.start", { ...start, prompt: "x".repeat(32_001) }),
    ).toEqual({ error: RpcErrors.badRequest });
  });

  test("session.start beyond the limit is tooManySessions", async () => {
    const { router, runtimes } = setup();
    for (let i = 0; i < 6; i++) runtimes.register(new FakeRuntime(`busy-${i}`));
    expect(await router.dispatch("session.start", { cwd: "/work/demo", prompt: "hello" })).toEqual({
      error: RpcErrors.tooManySessions,
    });
  });

  test("session.start without Claude Code wiring (demo) is claudeUnavailable", async () => {
    const { router } = setup({ chat: false });
    expect(await router.dispatch("session.start", { cwd: "/work/demo", prompt: "hello" })).toEqual({
      error: RpcErrors.claudeUnavailable,
    });
  });

  test("every control method reaches the runtime, or is not controllable", async () => {
    const { router, runtimes } = setup();
    const calls: [string, Record<string, unknown>][] = [
      ["session.send", { sessionId: "s1", text: "next" }],
      ["session.interrupt", { sessionId: "s1" }],
      ["agent.stop", { sessionId: "s1", agentId: "a0000000000000001" }],
      ["session.setModel", { sessionId: "s1", model: "opus" }],
      ["session.setPermissionMode", { sessionId: "s1", mode: "acceptEdits" }],
      [
        "question.answer",
        {
          sessionId: "s1",
          agentId: "main",
          requestId: "q1",
          answers: { "Which one?": "A" },
          response: "and quickly",
        },
      ],
    ];
    for (const [method, params] of calls) {
      expect({ method, out: await router.dispatch(method, params) }).toEqual({
        method,
        out: { error: RpcErrors.notControllable },
      });
    }
    const runtime = new FakeRuntime("s1");
    runtimes.register(runtime);
    for (const [method, params] of calls) {
      expect({ method, out: await router.dispatch(method, params) }).toEqual({
        method,
        out: { result: { ok: true } },
      });
    }
    expect(runtime.sent.map((s) => s.text)).toEqual(["next"]);
    expect(runtime.calls).toEqual([
      "interrupt",
      "stop:a0000000000000001",
      "model:opus",
      "mode:acceptEdits",
    ]);
    expect(runtime.questions).toEqual([
      {
        agentId: "main",
        requestId: "q1",
        answers: { "Which one?": "A" },
        response: "and quickly",
      },
    ]);
    expect(
      await router.dispatch("session.setPermissionMode", { sessionId: "s1", mode: "auto" }),
    ).toEqual({ error: RpcErrors.badRequest });
    expect(await router.dispatch("session.send", { sessionId: "s1", text: "" })).toEqual({
      error: RpcErrors.badRequest,
    });
  });

  test("runtime failures map to their codes", async () => {
    const { router, runtimes } = setup();
    const runtime = new FakeRuntime("s1");
    runtimes.register(runtime);
    runtime.failWith = new NotLoggedInError("s1");
    expect(await router.dispatch("session.send", { sessionId: "s1", text: "hi" })).toEqual({
      error: RpcErrors.notLoggedIn,
    });
    runtime.failWith = new InvalidAnswerError("q1");
    expect(
      await router.dispatch("question.answer", {
        sessionId: "s1",
        agentId: "main",
        requestId: "q1",
        answers: {},
      }),
    ).toEqual({ error: RpcErrors.badRequest });
  });

  test("session.conversation and claude.models", async () => {
    const { router, runtimes } = setup();
    expect(await router.dispatch("session.conversation", { sessionId: SID })).toEqual({
      result: {
        messages: [{ uuid: "u1", role: "user", ts: "2026-10-12T10:00:00.000Z", text: "hi" }],
      },
    });
    expect(await router.dispatch("session.conversation", { sessionId: "other" })).toEqual({
      result: { messages: [] },
    });
    expect(await router.dispatch("claude.models", undefined)).toEqual({
      result: { models: [...FALLBACK_MODELS] },
    });
    const runtime = new FakeRuntime("s1");
    runtime.supportedModels = async () => [{ value: "opus", displayName: "Opus 5.5" }];
    runtimes.register(runtime);
    expect(await router.dispatch("claude.models", {})).toEqual({
      result: { models: [{ value: "opus", displayName: "Opus 5.5" }] },
    });
  });
});

describe("rpc router: kill switch", () => {
  test("engine.stopAll disposes every runtime Gravita runs and says how many", async () => {
    const { router, runtimes } = setup();
    expect(await router.dispatch("engine.stopAll", undefined)).toEqual({ result: { stopped: 0 } });
    const a = new FakeRuntime("s1");
    const b = new FakeRuntime("s2");
    runtimes.register(a);
    runtimes.register(b);
    expect(await router.dispatch("engine.stopAll", {})).toEqual({ result: { stopped: 2 } });
    expect([a.disposed, b.disposed]).toEqual([true, true]);
    expect(await router.dispatch("engine.stopAll", "all")).toEqual({
      error: RpcErrors.badRequest,
    });
  });
});
