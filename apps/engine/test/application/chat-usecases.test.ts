import { describe, expect, test } from "bun:test";
import type { GravitaEvent } from "@gravita/protocol";
import type { EventPublisher } from "../../src/application/ports/event-publisher";
import { PermissionBroker } from "../../src/application/services/permission-broker";
import { ProjectionService } from "../../src/application/services/projection-service";
import { RuntimeFactoryRegistry } from "../../src/application/services/runtime-factory-registry";
import { InMemorySessionRuntimeRegistry } from "../../src/application/services/session-runtime-registry";
import { SessionSettingsRecorder } from "../../src/application/services/session-settings";
import { SquadSessions } from "../../src/application/squad/squad-sessions";
import { AnnounceProject } from "../../src/application/usecases/announce-project";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { FALLBACK_MODELS, ListModels } from "../../src/application/usecases/list-models";
import { SendMessage } from "../../src/application/usecases/send-message";
import { SetModel } from "../../src/application/usecases/set-model";
import { SetPermissionMode } from "../../src/application/usecases/set-permission-mode";
import { StartChat } from "../../src/application/usecases/start-chat";
import { StopAllSessions } from "../../src/application/usecases/stop-all-sessions";
import { MAX_CHAT_SESSIONS } from "../../src/domain/chat-policy";
import {
  InvalidAnswerError,
  InvalidCwdError,
  NotControllableError,
  ProviderUnavailableError,
  SessionStoppedError,
  TooManySessionsError,
} from "../../src/domain/errors";
import {
  FakeChatFactory,
  FakeClaudeEnvironment,
  FakeClock,
  FakeRuntime,
  FakeWorkspace,
  MemoryEventStore,
  SeqIds,
  SilentLogger,
} from "../fakes";

/** Records, for each published event of a session, whether a runtime owned it by then. */
class OwnershipProbe implements EventPublisher {
  readonly seen: { key: string; owned: boolean }[] = [];
  runtimes: InMemorySessionRuntimeRegistry | undefined;

  publish(events: readonly GravitaEvent[]) {
    for (const e of events) {
      if (e.sessionId) this.seen.push({ key: e.key, owned: !!this.runtimes?.isOwned(e.sessionId) });
    }
  }
}

function setup() {
  const clock = new FakeClock();
  const store = new MemoryEventStore();
  const projection = new ProjectionService();
  const probe = new OwnershipProbe();
  const ingest = new IngestEvents(store, projection, probe);
  const runtimes = new InMemorySessionRuntimeRegistry(ingest, clock);
  probe.runtimes = runtimes;
  const ids = new SeqIds();
  const settings = new SessionSettingsRecorder(ingest, clock);
  const environment = new FakeClaudeEnvironment();
  const workspace = new FakeWorkspace();
  const factory = new FakeChatFactory(runtimes);
  const projects = new AnnounceProject(
    { resolve: async (cwd) => ({ id: "p1", root: cwd, name: "demo" }) },
    ingest,
    clock,
  );
  const startChat = (maxSessions?: number) =>
    new StartChat({
      workspace,
      providers: new RuntimeFactoryRegistry({ claude: { factory, environment } }),
      runtimes,
      projects,
      ingest,
      settings,
      ids,
      clock,
      ...(maxSessions ? { maxSessions } : {}),
    });
  return {
    clock,
    store,
    projection,
    probe,
    ingest,
    runtimes,
    ids,
    settings,
    environment,
    workspace,
    factory,
    startChat,
  };
}

describe("StartChat", () => {
  test("registers the runtime before the session's first event, then sends the same uuid", async () => {
    const { startChat, store, probe, factory, projection } = setup();
    const out = await startChat().execute({
      cwd: "/work/demo",
      prompt: "Map   the\nrepo",
      model: "sonnet",
    });
    expect(out).toEqual({ sessionId: "id-1", projectId: "p1" });

    expect(probe.seen.every((s) => s.owned)).toBe(true);
    expect(store.rows.map((e) => e.type)).toEqual([
      "project.discovered",
      "session.started",
      "session.settings",
      "message.user",
    ]);
    const started = store.rows.find((e) => e.type === "session.started");
    expect(started).toMatchObject({
      key: "session:id-1:started",
      source: "gravita",
      data: {
        kind: "chat",
        cwd: "/work/demo",
        model: "sonnet",
        permissionMode: "default",
        cliVersion: "2.1.296",
      },
    });
    const user = store.rows.find((e) => e.type === "message.user");
    expect(user).toMatchObject({
      key: "user:id-2",
      agentId: "main",
      data: { uuid: "id-2", textPreview: "Map the repo", origin: "gravita" },
    });

    const runtime = factory.created[0]!;
    expect(runtime.spec).toMatchObject({
      sessionId: "id-1",
      projectId: "p1",
      cwd: "/work/demo",
      model: "sonnet",
      permissionMode: "default",
      environment: { cliPath: "/bin/claude" },
    });
    expect(runtime.registeredAtStart).toBe(true);
    expect(runtime.sent).toEqual([{ text: "Map   the\nrepo", uuid: "id-2" }]);

    const s = projection.session("id-1")!;
    expect(s).toMatchObject({
      kind: "chat",
      controllable: true,
      model: "sonnet",
      permissionMode: "default",
      firstUserText: "Map the repo",
    });
    expect(s.agents.main?.lifecycle).toBe("active");
  });

  test("without a first message the session starts idle and waits for the user's", async () => {
    const { startChat, store, factory, projection } = setup();
    const out = await startChat().execute({ cwd: "/work/demo" });
    expect(out).toEqual({ sessionId: "id-1", projectId: "p1" });

    expect(store.rows.map((e) => e.type)).toEqual([
      "project.discovered",
      "session.started",
      "session.settings",
    ]);
    const runtime = factory.created[0]!;
    expect(runtime.registeredAtStart).toBe(true);
    expect(runtime.sent).toEqual([]);
    const s = projection.session("id-1")!;
    expect(s).toMatchObject({ kind: "chat", controllable: true });
    expect(s.firstUserText).toBeUndefined();
  });

  test("validates the folder and Claude Code before creating anything", async () => {
    const { startChat, environment, factory, store, runtimes } = setup();
    const badCwd = await startChat()
      .execute({ cwd: "/missing", prompt: "hi" })
      .catch((e) => e);
    expect(badCwd).toBeInstanceOf(InvalidCwdError);
    expect(environment.loads).toBe(0);

    environment.result = new ProviderUnavailableError("claude", "not-found");
    const noClaude = await startChat()
      .execute({ cwd: "/work/demo", prompt: "hi" })
      .catch((e) => e);
    expect(noClaude).toBeInstanceOf(ProviderUnavailableError);
    expect(factory.created).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
    expect(runtimes.all()).toHaveLength(0);
  });

  test("refuses beyond the concurrency limit (default 6)", async () => {
    const { startChat, runtimes, factory } = setup();
    expect(MAX_CHAT_SESSIONS).toBe(6);
    const chat = startChat(2);
    await chat.execute({ cwd: "/work/demo", prompt: "one" });
    await chat.execute({ cwd: "/work/demo", prompt: "two" });
    const err = await chat.execute({ cwd: "/work/demo", prompt: "three" }).catch((e) => e);
    expect(err).toBeInstanceOf(TooManySessionsError);
    expect(factory.created).toHaveLength(2);

    // Two starts racing past the first check: the second one is refused after the awaits.
    runtimes.unregister(factory.created[1]!.sessionId);
    const [a, b] = await Promise.allSettled([
      chat.execute({ cwd: "/work/demo", prompt: "x" }),
      chat.execute({ cwd: "/work/demo", prompt: "y" }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    expect(runtimes.all()).toHaveLength(2);
  });

  test("squad sessions don't count against the chat limit", async () => {
    const { startChat, runtimes } = setup();
    for (const id of ["q-a", "q-b", "q-c"]) {
      const squadRuntime = new FakeRuntime(id);
      Object.assign(squadRuntime, { kind: "squad" });
      runtimes.register(squadRuntime);
    }
    const chat = startChat(2);
    await chat.execute({ cwd: "/work/demo", prompt: "one" });
    await chat.execute({ cwd: "/work/demo", prompt: "two" });
    expect(
      await chat.execute({ cwd: "/work/demo", prompt: "three" }).catch((e) => e),
    ).toBeInstanceOf(TooManySessionsError);
    expect(runtimes.all()).toHaveLength(5);
  });

  test("a failed first send unregisters and disposes the runtime", async () => {
    const { startChat, factory, runtimes, projection } = setup();
    factory.failSend = new Error("stream closed");
    const err = await startChat()
      .execute({ cwd: "/work/demo", prompt: "hi" })
      .catch((e) => e);
    expect(err).toEqual(new Error("stream closed"));
    expect(factory.created[0]!.disposed).toBe(true);
    expect(runtimes.all()).toEqual([]);
    expect(projection.session("id-1")?.controllable).toBe(false);
  });
});

describe("the kill switch and sessions still opening", () => {
  /** Runtimes that open (like Codex, which takes seconds) when `open` is called. */
  function slowOpening(factory: FakeChatFactory) {
    let open!: () => void;
    factory.opening = new Promise<void>((r) => {
      open = r;
    });
    return () => open();
  }

  const created = async (factory: FakeChatFactory) => {
    for (let i = 0; i < 100 && !factory.created.length; i++) await Bun.sleep(1);
    return factory.created[0]!;
  };

  test("a chat still opening is stopped: it never registers nor gets its first message", async () => {
    const s = setup();
    const open = slowOpening(s.factory);
    const starting = s
      .startChat()
      .execute({ cwd: "/work/demo", prompt: "hi" })
      .catch((e: unknown) => e);
    const runtime = await created(s.factory);
    const stopAll = new StopAllSessions(s.runtimes, s.clock, new SilentLogger(), 1_000);
    expect(await stopAll.execute()).toEqual({ stopped: 1 });
    expect(runtime.disposed).toBe(true);
    open();
    expect(await starting).toBeInstanceOf(SessionStoppedError);
    expect(runtime.started).toBe(false);
    expect(runtime.sent).toEqual([]);
    expect(s.runtimes.all()).toEqual([]);
    expect(s.store.rows.map((e) => e.type)).toEqual(["project.discovered"]);
    // Once it is done opening, the registry no longer holds it.
    expect(await stopAll.execute()).toEqual({ stopped: 0 });
  });

  test("a squad session still opening is stopped the same way", async () => {
    const s = setup();
    const open = slowOpening(s.factory);
    const sessions = new SquadSessions({
      providers: new RuntimeFactoryRegistry({
        claude: { factory: s.factory, environment: s.environment },
      }),
      runtimes: s.runtimes,
      ingest: s.ingest,
      ids: s.ids,
      clock: s.clock,
      logger: new SilentLogger(),
      settings: s.settings,
    });
    const starting = sessions
      .start({
        squadId: "q1",
        projectId: "p1",
        roleId: "backend",
        taskId: "t1",
        cwd: "/work/demo",
        model: "sonnet",
        permissionMode: "acceptEdits",
        prompt: "Your task",
      })
      .catch((e: unknown) => e);
    const runtime = await created(s.factory);
    await new StopAllSessions(s.runtimes, s.clock, new SilentLogger(), 1_000).execute();
    open();
    expect(await starting).toBeInstanceOf(SessionStoppedError);
    expect(runtime.disposed).toBe(true);
    expect(runtime.sent).toEqual([]);
    expect(s.runtimes.all()).toEqual([]);
    expect(s.store.rows).toEqual([]);
  });

  test("a runtime that opens normally registers and lets go of the opening hold", async () => {
    const s = setup();
    const open = slowOpening(s.factory);
    const starting = s.startChat().execute({ cwd: "/work/demo", prompt: "hi" });
    const runtime = await created(s.factory);
    open();
    expect(await starting).toEqual({ sessionId: "id-1", projectId: "p1" });
    expect(runtime.sent).toHaveLength(1);
    expect(s.runtimes.cancelOpening()).toEqual([]);
  });
});

describe("SendMessage, SetModel, SetPermissionMode", () => {
  test("a message is recorded as the user's (origin gravita) and sent with its uuid", async () => {
    const { ingest, runtimes, ids, clock, store } = setup();
    const runtime = new FakeRuntime("s1");
    runtimes.register(runtime);
    await new SendMessage(runtimes, ingest, ids, clock).execute({ sessionId: "s1", text: "next" });
    expect(store.rows.at(-1)).toMatchObject({
      key: "user:id-1",
      type: "message.user",
      data: { uuid: "id-1", textPreview: "next", origin: "gravita" },
    });
    expect(runtime.sent).toEqual([{ text: "next", uuid: "id-1" }]);
    const err = await new SendMessage(runtimes, ingest, ids, clock)
      .execute({ sessionId: "nope", text: "x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NotControllableError);
  });

  test("model and mode changes reach the runtime and are recorded, each one", async () => {
    const { runtimes, settings, projection, store } = setup();
    const runtime = new FakeRuntime("s1");
    runtimes.register(runtime);
    await new SetModel(runtimes, settings).execute({ sessionId: "s1", model: "opus" });
    await new SetModel(runtimes, settings).execute({ sessionId: "s1", model: "haiku" });
    await new SetPermissionMode(runtimes, settings).execute({ sessionId: "s1", mode: "plan" });
    expect(runtime.calls).toEqual(["model:opus", "model:haiku", "mode:plan"]);
    const keys = store.rows.filter((e) => e.type === "session.settings").map((e) => e.key);
    expect(new Set(keys).size).toBe(3);
    expect(projection.session("s1")).toMatchObject({ model: "haiku", permissionMode: "plan" });

    runtime.failWith = new NotControllableError("s1");
    const err = await new SetModel(runtimes, settings)
      .execute({ sessionId: "s1", model: "opus" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NotControllableError);
    expect(store.rows.filter((e) => e.type === "session.settings")).toHaveLength(3);
  });
});

describe("ListModels", () => {
  test("asks a live runtime, remembers the answer, and falls back to the aliases", async () => {
    const { runtimes, clock } = setup();
    const list = new ListModels(runtimes, clock, new SilentLogger());
    expect((await list.execute()).models).toEqual([...FALLBACK_MODELS]);

    const slow = new FakeRuntime("slow");
    slow.supportedModels = () => new Promise(() => {});
    runtimes.register(slow);
    const pending = list.execute();
    clock.advance(3_000);
    expect((await pending).models).toEqual([...FALLBACK_MODELS]);

    runtimes.unregister("slow");
    const live = new FakeRuntime("live");
    live.supportedModels = async () => [{ value: "sonnet", displayName: "Sonnet 5" }];
    runtimes.register(live);
    expect((await list.execute()).models).toEqual([{ value: "sonnet", displayName: "Sonnet 5" }]);
    runtimes.unregister("live");
    expect((await list.execute()).models).toEqual([{ value: "sonnet", displayName: "Sonnet 5" }]);
  });
});

describe("PermissionBroker", () => {
  function broker() {
    const { ingest, store, projection, clock } = setup();
    const b = new PermissionBroker({
      session: { sessionId: "s1", projectId: "p1", provider: "claude" },
      ingest,
      clock,
      describeInput: (input) => String(input.command ?? "?"),
    });
    return { b, store, projection };
  }

  const ASK = {
    questions: [
      {
        question: "Which database?",
        header: "DB",
        multiSelect: false,
        options: [{ label: "Postgres", description: "Current" }, { label: "SQLite" }],
      },
      { question: "Checks?", multiSelect: true, options: [{ label: "Unit" }, { label: "E2E" }] },
    ],
  };

  test("a tool permission waits for the user's decision", async () => {
    const { b, store, projection } = broker();
    const input = { command: "rm -rf build" };
    const decision = b.request({ toolName: "Bash", input, requestId: "r1", toolUseId: "t1" });
    expect(store.rows.at(-1)).toMatchObject({
      key: "perm:r1:requested",
      agentId: "main",
      type: "permission.requested",
      data: { requestId: "r1", toolUseId: "t1", toolName: "Bash", inputPreview: "rm -rf build" },
    });
    expect(projection.session("s1")!.agents.main!.lifecycle).toBe("waiting_user");
    expect(() => b.respond("a0000000000000001", "r1", "allow")).toThrow(NotControllableError);
    expect(() => b.answer("main", "r1", { x: "y" })).toThrow(NotControllableError);
    b.respond("main", "r1", "allow");
    expect(await decision).toEqual({ behavior: "allow", updatedInput: input });
    expect(store.rows.at(-1)).toMatchObject({
      key: "perm:r1:resolved",
      data: { decision: "allow", by: "user" },
    });
    expect(projection.session("s1")!.agents.main!.pendingPermissions).toEqual([]);
    expect(() => b.respond("main", "r1", "deny")).toThrow(NotControllableError);

    const denied = b.request({ toolName: "Bash", input, requestId: "r2", agentId: "a1" });
    b.respond("a1", "r2", "deny");
    expect(await denied).toMatchObject({ behavior: "deny" });
  });

  test("AskUserQuestion becomes a question; answers go back in the tool input", async () => {
    const { b, store, projection } = broker();
    const decision = b.request({ toolName: "AskUserQuestion", input: ASK, requestId: "q1" });
    expect(store.rows.at(-1)).toMatchObject({
      key: "question:q1:asked",
      type: "question.asked",
      data: {
        requestId: "q1",
        questions: [
          {
            question: "Which database?",
            header: "DB",
            multiSelect: false,
            options: [{ label: "Postgres", description: "Current" }, { label: "SQLite" }],
          },
          {
            question: "Checks?",
            multiSelect: true,
            options: [{ label: "Unit" }, { label: "E2E" }],
          },
        ],
      },
    });
    expect(Object.keys(projection.session("s1")!.agents.main!.questions)).toEqual(["q1"]);
    expect(() => b.respond("main", "q1", "allow")).toThrow(NotControllableError);
    expect(() => b.answer("main", "q1", { "Not asked": "x" })).toThrow(InvalidAnswerError);

    b.answer(
      "main",
      "q1",
      { "Which database?": "Postgres", "Checks?": "Unit, E2E", junk: "x" },
      " fast ",
    );
    expect(await decision).toEqual({
      behavior: "allow",
      updatedInput: {
        ...ASK,
        answers: { "Which database?": "Postgres", "Checks?": "Unit, E2E" },
        response: "fast",
      },
    });
    expect(store.rows.at(-1)).toMatchObject({
      key: "question:q1:answered",
      type: "question.answered",
      data: { requestId: "q1", by: "user" },
    });
    expect(projection.session("s1")!.agents.main!.questions).toEqual({});
    expect(projection.session("s1")!.agents.main!.lifecycle).toBe("active");
  });

  test("a malformed question falls back to a permission prompt", async () => {
    const { b, store } = broker();
    void b.request({ toolName: "AskUserQuestion", input: { questions: "?" }, requestId: "q2" });
    expect(store.rows.at(-1)?.type).toBe("permission.requested");
  });

  test("cancelled by the agent or closed with the session: deny, by timeout", async () => {
    const { b, store } = broker();
    const ctl = new AbortController();
    const cancelled = b.request({
      toolName: "Bash",
      input: {},
      requestId: "r1",
      signal: ctl.signal,
    });
    ctl.abort();
    expect(await cancelled).toMatchObject({ behavior: "deny" });
    expect(store.rows.at(-1)).toMatchObject({
      key: "perm:r1:resolved",
      data: { decision: "deny", by: "timeout" },
    });

    const a = b.request({ toolName: "Bash", input: {}, requestId: "r2" });
    const q = b.request({ toolName: "AskUserQuestion", input: ASK, requestId: "q3" });
    expect(b.size).toBe(2);
    b.dispose();
    expect(await a).toMatchObject({ behavior: "deny" });
    expect(await q).toMatchObject({ behavior: "deny" });
    expect(store.rows.slice(-2).map((e) => [e.key, (e.data as { by: string }).by])).toEqual([
      ["perm:r2:resolved", "timeout"],
      ["question:q3:answered", "timeout"],
    ]);
    expect(await b.request({ toolName: "Bash", input: {}, requestId: "r9" })).toMatchObject({
      behavior: "deny",
    });
    expect(b.size).toBe(0);
  });
});
