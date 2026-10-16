import { describe, expect, test } from "bun:test";
import { RpcErrors } from "@gravita/protocol";
import { EventBroadcaster } from "../../src/application/services/event-broadcaster";
import { ProjectionService } from "../../src/application/services/projection-service";
import { RuntimeFactoryRegistry } from "../../src/application/services/runtime-factory-registry";
import { InMemorySessionRuntimeRegistry } from "../../src/application/services/session-runtime-registry";
import { SessionSettingsRecorder } from "../../src/application/services/session-settings";
import type { SquadOrchestrator } from "../../src/application/squad/squad-orchestrator";
import { AnnounceProject } from "../../src/application/usecases/announce-project";
import { AnswerQuestion } from "../../src/application/usecases/answer-question";
import { GetConversation } from "../../src/application/usecases/get-conversation";
import { GetEngineStatus } from "../../src/application/usecases/get-engine-status";
import { GetSessionEvents } from "../../src/application/usecases/get-session-events";
import { GetSnapshot } from "../../src/application/usecases/get-snapshot";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { InterruptSession } from "../../src/application/usecases/interrupt-session";
import { FALLBACK_MODELS, ListModels } from "../../src/application/usecases/list-models";
import { RemoveSession } from "../../src/application/usecases/remove-session";
import { RespondToPermission } from "../../src/application/usecases/respond-to-permission";
import { SendMessage } from "../../src/application/usecases/send-message";
import { SetModel } from "../../src/application/usecases/set-model";
import { SetPermissionMode } from "../../src/application/usecases/set-permission-mode";
import { StartChat } from "../../src/application/usecases/start-chat";
import { StopAgent } from "../../src/application/usecases/stop-agent";
import { StopAllSessions } from "../../src/application/usecases/stop-all-sessions";
import {
  DirtyWorktreeError,
  GhUnavailableError,
  InvalidAnswerError,
  InvalidSquadPlanError,
  NotARepositoryError,
  NotLoggedInError,
  ProviderUnavailableError,
  SquadNotFoundError,
  SquadPhaseError,
  SquadWorkspaceError,
  TerminalNotFoundError,
  TooManySquadsError,
  TooManyTerminalsError,
} from "../../src/domain/errors";
import {
  createRouter,
  INTERNAL_ERROR,
  rpcHandlers,
  toRpcError,
} from "../../src/interface/rpc/router";
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

function setup(opts: { chat?: boolean; squads?: SquadOrchestrator } = {}) {
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
    providers: new RuntimeFactoryRegistry({ claude: { factory, environment } }),
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
    removeSession: new RemoveSession(runtimes, projection, ingest, clock),
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
    ...(opts.squads ? { squads: opts.squads } : {}),
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
        providers: { claude: { found: true, path: "/bin/claude" } },
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
    environment.result = new ProviderUnavailableError("claude", "outdated");
    expect(await router.dispatch("session.start", start)).toEqual({
      error: { ...RpcErrors.providerUnavailable, data: { provider: "claude" } },
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

  test("session.start without Claude Code wiring (demo) is providerUnavailable", async () => {
    const { router } = setup({ chat: false });
    expect(await router.dispatch("session.start", { cwd: "/work/demo", prompt: "hello" })).toEqual({
      error: { ...RpcErrors.providerUnavailable, data: { provider: "claude" } },
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
    runtime.failWith = new NotLoggedInError("claude", "s1");
    expect(await router.dispatch("session.send", { sessionId: "s1", text: "hi" })).toEqual({
      error: { ...RpcErrors.notLoggedIn, data: { provider: "claude" } },
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

describe("rpc router: providers", () => {
  test("models.list asks the named provider; claude.models is Claude's", async () => {
    const { router, runtimes } = setup();
    expect(await router.dispatch("models.list", { provider: "claude" })).toEqual({
      result: { models: [...FALLBACK_MODELS] },
    });
    expect(await router.dispatch("models.list", { provider: "codex" })).toEqual({
      result: { models: [] },
    });
    expect(await router.dispatch("models.list", {})).toEqual({ error: RpcErrors.badRequest });
    const runtime = new FakeRuntime("s1");
    runtime.supportedModels = async () => [{ value: "opus", displayName: "Opus 5.5" }];
    runtimes.register(runtime);
    const claude = { result: { models: [{ value: "opus", displayName: "Opus 5.5" }] } };
    expect(await router.dispatch("models.list", { provider: "claude" })).toEqual(claude);
    expect(await router.dispatch("claude.models", undefined)).toEqual(claude);
  });

  test("a provider the engine can't run is providerUnavailable, naming it", async () => {
    const { router } = setup();
    const start = { cwd: "/work/demo", prompt: "hello", provider: "codex" };
    expect(await router.dispatch("session.start", start)).toEqual({
      error: { ...RpcErrors.providerUnavailable, data: { provider: "codex" } },
    });
    const demo = setup({ chat: false });
    expect(await demo.router.dispatch("session.start", start)).toEqual({
      error: { ...RpcErrors.providerUnavailable, data: { provider: "codex" } },
    });
  });

  test("another provider's mode is a bad request", async () => {
    const { router, runtimes, factory } = setup();
    const start = { cwd: "/work/demo", prompt: "hello", permissionMode: "workspace" };
    expect(await router.dispatch("session.start", start)).toMatchObject({
      error: { code: RpcErrors.badRequest.code },
    });
    expect(factory.created).toHaveLength(0);
    runtimes.register(new FakeRuntime("s1"));
    expect(
      await router.dispatch("session.setPermissionMode", { sessionId: "s1", mode: "fullAccess" }),
    ).toMatchObject({ error: { code: RpcErrors.badRequest.code } });
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

describe("rpc router: squads", () => {
  const plan = {
    goal: "A todo app",
    summary: "An API for todos.",
    stack: ["hono"],
    roles: [{ id: "backend", name: "Backend", kind: "backend", owns: ["apps/api/"], charter: "" }],
    shared: { paths: [], strategy: "regenerate" },
    contracts: [],
    tasks: [
      {
        id: "api",
        role: "backend",
        title: "Todos API",
        plainSummary: "Lets the app save todos.",
        dependsOn: [],
        writes: ["apps/api/src/"],
        acceptance: ["GET /todos lists todos"],
        size: "s",
      },
    ],
    checks: [],
    assumptions: [],
    questions: [],
  };
  const sq = { squadId: "q1" };
  const calls: [string, Record<string, unknown>][] = [
    [
      "squad.create",
      { cwd: "/work/todo", brief: "A todo app", budgetUsd: 20, autonomy: "guarded" },
    ],
    ["squad.plan", sq],
    ["squad.replan", { ...sq, feedback: "Split the API" }],
    ["squad.approvePlan", { ...sq, plan }],
    ["squad.pause", sq],
    ["squad.resume", sq],
    ["squad.stop", sq],
    ["squad.task.retry", { ...sq, taskId: "api", model: "opus" }],
    ["squad.task.skip", { ...sq, taskId: "api" }],
    ["squad.task.reassign", { ...sq, taskId: "api", role: "backend" }],
    ["squad.deliver", { ...sq, mode: "pr" }],
  ];

  test("without an orchestrator (the demo), every squad method says squads need Claude Code", async () => {
    const { router } = setup();
    for (const [method, params] of calls) {
      expect({ method, out: await router.dispatch(method, params) }).toEqual({
        method,
        out: {
          error: {
            code: RpcErrors.squadPhase.code,
            message: "Squads run with Claude Code; the demo only plays a scripted one",
          },
        },
      });
    }
  });

  test("with an orchestrator, each method calls it and answers its result", async () => {
    const seen: string[] = [];
    const record = (name: string, result?: unknown) => async (p: { squadId?: string }) => {
      seen.push(`${name}:${p.squadId ?? ""}`);
      return result;
    };
    const fake = {
      create: record("create", { squadId: "q1", projectId: "p1" }),
      plan: (p: { squadId: string }) => void seen.push(`plan:${p.squadId}`),
      replan: record("replan"),
      approvePlan: record("approvePlan"),
      pause: (p: { squadId: string }) => void seen.push(`pause:${p.squadId}`),
      resume: (p: { squadId: string }) => void seen.push(`resume:${p.squadId}`),
      stop: record("stop"),
      retryTask: (p: { squadId: string }) => void seen.push(`retry:${p.squadId}`),
      skipTask: (p: { squadId: string }) => void seen.push(`skip:${p.squadId}`),
      reassignTask: (p: { squadId: string }) => void seen.push(`reassign:${p.squadId}`),
      deliver: record("deliver", { ref: "main" }),
    } as unknown as SquadOrchestrator;
    const { router } = setup({ squads: fake });
    const outs = [];
    for (const [method, params] of calls) outs.push(await router.dispatch(method, params));
    expect(outs).toEqual([
      { result: { squadId: "q1", projectId: "p1" } },
      ...Array(9).fill({ result: { ok: true } }),
      { result: { ref: "main" } },
    ]);
    expect(seen).toEqual([
      "create:",
      "plan:q1",
      "replan:q1",
      "approvePlan:q1",
      "pause:q1",
      "resume:q1",
      "stop:q1",
      "retry:q1",
      "skip:q1",
      "reassign:q1",
      "deliver:q1",
    ]);
  });

  test("squad errors map to their codes, keeping the messages that say what to do", async () => {
    const throwing = (err: Error) =>
      ({
        pause: () => {
          throw err;
        },
      }) as unknown as SquadOrchestrator;
    const cases: [Error, { code: number; message: string }][] = [
      [new SquadNotFoundError("q1"), RpcErrors.squadNotFound],
      [
        new SquadPhaseError("Only a squad that is working can be paused."),
        { code: RpcErrors.squadPhase.code, message: "Only a squad that is working can be paused." },
      ],
      [
        new TooManySquadsError(2),
        {
          code: RpcErrors.tooManySessions.code,
          message: "At most 2 squads can run at once; pause or finish one first",
        },
      ],
      [
        new InvalidSquadPlanError('Roles "a" and "b" overlap.'),
        { code: RpcErrors.invalidPlan.code, message: 'Roles "a" and "b" overlap.' },
      ],
      [new DirtyWorktreeError("/r"), RpcErrors.dirtyWorktree],
    ];
    for (const [err, want] of cases) {
      const { router } = setup({ squads: throwing(err) });
      expect(await router.dispatch("squad.pause", sq)).toEqual({ error: want });
    }
  });

  test("their params are still validated first", async () => {
    const { router } = setup();
    expect(await router.dispatch("squad.pause", {})).toEqual({ error: RpcErrors.badRequest });
    for (const bad of [{ budgetUsd: 0 }, { budgetUsd: 5_000 }, { roleBudgets: { backend: -1 } }])
      expect(await router.dispatch("squad.resume", { ...sq, ...bad })).toEqual({
        error: RpcErrors.badRequest,
      });
    expect(await router.dispatch("squad.deliver", { ...sq, mode: "push" })).toEqual({
      error: RpcErrors.badRequest,
    });
  });
});

describe("rpc router: squad workspace errors", () => {
  test("map to the squad codes, keeping messages that say what to do", () => {
    const logger = new SilentLogger();
    const cases: [Error, { code: number; message: string }][] = [
      [new DirtyWorktreeError("/repo"), RpcErrors.dirtyWorktree],
      [
        new GhUnavailableError("not-logged-in"),
        {
          code: RpcErrors.ghUnavailable.code,
          message: "The GitHub CLI (gh) is not logged in; run `gh auth login`",
        },
      ],
      [
        new GhUnavailableError("no-remote"),
        { code: 4013, message: "This repository has no remote to push to" },
      ],
      [
        new NotARepositoryError("/x"),
        { code: RpcErrors.invalidCwd.code, message: new NotARepositoryError("/x").message },
      ],
      [
        new InvalidSquadPlanError('"integration" is reserved'),
        { code: RpcErrors.invalidPlan.code, message: '"integration" is reserved' },
      ],
      [
        new SquadWorkspaceError("wrong-branch", 'Check out "main"'),
        { code: RpcErrors.squadPhase.code, message: 'Check out "main"' },
      ],
    ];
    for (const [err, expected] of cases)
      expect(toRpcError(err, logger, "squad.deliver")).toEqual(expected);
    expect(logger.lines).toEqual([]);
  });
});

describe("rpc router: terminals", () => {
  test("answer that terminals are unsupported when the engine has none, but list none", async () => {
    const { router } = setup();
    expect(
      await router.dispatch("terminal.spawn", {
        cwd: "/work/demo",
        command: "shell",
        cols: 80,
        rows: 24,
      }),
    ).toEqual({ error: RpcErrors.terminalUnsupported });
    expect(await router.dispatch("terminal.list", undefined)).toEqual({
      result: { terminals: [] },
    });
  });

  test("validate sizes and commands before anything runs", async () => {
    const { router } = setup();
    const bad = await router.dispatch("terminal.spawn", {
      cwd: "/work/demo",
      command: "rm",
      cols: 0,
      rows: 24,
    });
    expect(bad).toMatchObject({ error: { code: RpcErrors.badRequest.code } });
  });

  test("map their errors to their codes", () => {
    const logger = new SilentLogger();
    expect(toRpcError(new TooManyTerminalsError(8), logger, "terminal.spawn")).toEqual(
      RpcErrors.tooManyTerminals,
    );
    expect(toRpcError(new TerminalNotFoundError("t"), logger, "terminal.write")).toEqual(
      RpcErrors.terminalNotFound,
    );
  });
});

describe("rpc router: git", () => {
  test("answers that a folder isn't a repository when the engine reads none", async () => {
    const { router } = setup();
    expect(await router.dispatch("git.info", { cwd: "/work/demo" })).toEqual({
      result: { repo: false },
    });
    expect(await router.dispatch("git.info", { cwd: "" })).toMatchObject({
      error: { code: RpcErrors.badRequest.code },
    });
  });
});
