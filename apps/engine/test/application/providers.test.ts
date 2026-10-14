import { describe, expect, test } from "bun:test";
import { RpcErrors } from "@gravita/protocol";
import { EventBroadcaster, FLUSH_MS } from "../../src/application/services/event-broadcaster";
import { ProjectionService } from "../../src/application/services/projection-service";
import { RuntimeFactoryRegistry } from "../../src/application/services/runtime-factory-registry";
import { InMemorySessionRuntimeRegistry } from "../../src/application/services/session-runtime-registry";
import { SessionSettingsRecorder } from "../../src/application/services/session-settings";
import { SquadSessions } from "../../src/application/squad/squad-sessions";
import { AnnounceProject } from "../../src/application/usecases/announce-project";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { ListModels } from "../../src/application/usecases/list-models";
import { SetPermissionMode } from "../../src/application/usecases/set-permission-mode";
import { StartChat } from "../../src/application/usecases/start-chat";
import { InvalidSessionModeError, ProviderUnavailableError } from "../../src/domain/errors";
import { toRpcError } from "../../src/interface/rpc/router";
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

function setup() {
  const clock = new FakeClock();
  const store = new MemoryEventStore();
  const projection = new ProjectionService();
  const broadcaster = new EventBroadcaster(clock, {
    indexing: { done: 0, total: 0 },
    demo: false,
  });
  const ingest = new IngestEvents(store, projection, broadcaster);
  const runtimes = new InMemorySessionRuntimeRegistry(ingest, clock);
  const settings = new SessionSettingsRecorder(ingest, clock);
  const claude = new FakeChatFactory(runtimes);
  const codex = new FakeChatFactory(runtimes);
  const providers = new RuntimeFactoryRegistry({
    claude: { factory: claude, environment: new FakeClaudeEnvironment() },
  });
  const ids = new SeqIds();
  const startChat = (registry = providers) =>
    new StartChat({
      workspace: new FakeWorkspace(),
      providers: registry,
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
  const squadSessions = (registry = providers) =>
    new SquadSessions({
      providers: registry,
      runtimes,
      ingest,
      ids,
      clock,
      logger: new SilentLogger(),
      settings,
    });
  return {
    clock,
    store,
    broadcaster,
    runtimes,
    settings,
    claude,
    codex,
    providers,
    startChat,
    squadSessions,
  };
}

describe("runtime factories by provider", () => {
  test("the registry picks the factory and loads the environment of the provider asked", async () => {
    const { claude, codex, runtimes } = setup();
    const registry = new RuntimeFactoryRegistry({
      claude: { factory: claude, environment: new FakeClaudeEnvironment() },
      codex: {
        factory: codex,
        environment: new FakeClaudeEnvironment({
          provider: "codex",
          cliPath: "/bin/codex",
          env: {},
        }),
      },
    });
    expect(registry.providers().sort()).toEqual(["claude", "codex"]);
    const ready = await registry.ready("codex");
    expect(ready.factory).toBe(codex);
    expect(ready.environment).toMatchObject({ provider: "codex", cliPath: "/bin/codex" });
    expect((await registry.ready("claude")).factory).toBe(claude);
    expect(runtimes.all()).toHaveLength(0);
  });

  test("a provider without runtimes is unavailable, named in the error", async () => {
    const { providers } = setup();
    expect(providers.has("codex")).toBe(false);
    const err = await providers.ready("codex").catch((e) => e);
    expect(err).toEqual(new ProviderUnavailableError("codex", "not-found"));
    expect(toRpcError(err, new SilentLogger(), "session.start")).toEqual({
      ...RpcErrors.providerUnavailable,
      data: { provider: "codex" },
    });
  });

  test("StartChat runs the provider the request names, Claude Code when it names none", async () => {
    const { startChat, claude, codex, store } = setup();
    await startChat().execute({ cwd: "/work/demo", prompt: "hi" });
    expect(claude.created[0]?.spec.provider).toBe("claude");
    expect(claude.created[0]?.spec.environment.provider).toBe("claude");
    expect(store.rows.every((e) => e.provider === "claude")).toBe(true);

    const both = new RuntimeFactoryRegistry({
      claude: { factory: claude, environment: new FakeClaudeEnvironment() },
      codex: {
        factory: codex,
        environment: new FakeClaudeEnvironment({ provider: "codex", cliPath: "/c", env: {} }),
      },
    });
    await startChat(both).execute({
      cwd: "/work/demo",
      prompt: "hi",
      provider: "codex",
      permissionMode: "workspace",
    });
    expect(codex.created[0]?.spec).toMatchObject({
      provider: "codex",
      permissionMode: "workspace",
    });
    const started = store.rows.filter((e) => e.type === "session.started").at(-1);
    expect(started).toMatchObject({ provider: "codex", data: { permissionMode: "workspace" } });
    // Settings events carry Claude's terms; Codex's modes map one to one.
    const settings = store.rows.filter((e) => e.type === "session.settings").at(-1);
    expect(settings).toMatchObject({ provider: "codex", data: { permissionMode: "acceptEdits" } });
  });

  test("a session starts only in one of its provider's modes", async () => {
    const { startChat, claude } = setup();
    const err = await startChat()
      .execute({ cwd: "/work/demo", prompt: "hi", permissionMode: "fullAccess" })
      .catch((e) => e);
    expect(err).toEqual(new InvalidSessionModeError("claude", "fullAccess"));
    expect(claude.created).toHaveLength(0);
    expect(toRpcError(err, new SilentLogger(), "session.start").code).toBe(
      RpcErrors.badRequest.code,
    );
  });

  test("switching modes is checked against the session's provider", async () => {
    const { runtimes, settings } = setup();
    const runtime = new FakeRuntime("s1");
    runtimes.register(runtime);
    const set = new SetPermissionMode(runtimes, settings);
    await expect(set.execute({ sessionId: "s1", mode: "workspace" })).rejects.toBeInstanceOf(
      InvalidSessionModeError,
    );
    await set.execute({ sessionId: "s1", mode: "plan" });
    expect(runtime.calls).toEqual(["mode:plan"]);
  });
});

describe("squad sessions by provider", () => {
  const spec = {
    squadId: "q1",
    projectId: "p1",
    cwd: "/work/demo",
    model: "sonnet",
    permissionMode: "dontAsk" as const,
    prompt: "plan",
  };

  test("a squad session runs on the squad's provider unless its spec names another", async () => {
    const { squadSessions, claude, codex, store } = setup();
    const session = await squadSessions().start(spec);
    expect(claude.created[0]?.spec).toMatchObject({ provider: "claude", kind: "squad" });
    expect(session.runtime.provider).toBe("claude");
    expect(store.rows.every((e) => e.provider === "claude")).toBe(true);

    const both = new RuntimeFactoryRegistry({
      claude: { factory: claude, environment: new FakeClaudeEnvironment() },
      codex: {
        factory: codex,
        environment: new FakeClaudeEnvironment({ provider: "codex", cliPath: "/c", env: {} }),
      },
    });
    await squadSessions(both).start({ ...spec, provider: "codex", permissionMode: "workspace" });
    expect(codex.created[0]?.spec.provider).toBe("codex");
    await expect(squadSessions().start({ ...spec, provider: "codex" })).rejects.toEqual(
      new ProviderUnavailableError("codex", "not-found"),
    );
  });
});

describe("models by provider", () => {
  test("a provider's models come from its own live sessions, else its fallbacks", async () => {
    const { runtimes, clock } = setup();
    const list = new ListModels(runtimes, clock, new SilentLogger());
    const claude = new FakeRuntime("s1");
    claude.supportedModels = async () => [{ value: "opus", displayName: "Opus 5.5" }];
    runtimes.register(claude);
    expect(await list.execute("codex")).toEqual({ models: [] });
    expect(await list.execute("claude")).toEqual({
      models: [{ value: "opus", displayName: "Opus 5.5" }],
    });

    const codex = new FakeRuntime("s2", "p1", "codex");
    codex.supportedModels = async () => [{ value: "gpt-5.5", displayName: "GPT-5.5" }];
    runtimes.register(codex);
    expect(await list.execute("codex")).toEqual({
      models: [{ value: "gpt-5.5", displayName: "GPT-5.5" }],
    });
  });
});

describe("provider status", () => {
  test("providers.claude and the deprecated claude alias stay equal", () => {
    const { broadcaster, clock } = setup();
    expect(broadcaster.status()).toMatchObject({
      providers: { claude: { found: false } },
      claude: { found: false },
    });
    const seen: unknown[] = [];
    broadcaster.listen({ status: (s) => seen.push(s) });
    broadcaster.updateProvider("claude", { found: true, path: "/bin/claude", version: "2.1.296" });
    broadcaster.updateProvider("claude", { loggedIn: false });
    clock.advance(FLUSH_MS);
    const claude = { found: true, path: "/bin/claude", version: "2.1.296", loggedIn: false };
    expect(seen).toEqual([
      { providers: { claude }, claude, indexing: { done: 0, total: 0 }, demo: false },
    ]);
    expect(broadcaster.providerStatus("claude")).toEqual(claude);
    expect(broadcaster.providerStatus("codex")).toBeUndefined();
  });

  test("another provider's status leaves the alias alone", () => {
    const { broadcaster } = setup();
    broadcaster.updateProvider("codex", { found: true, path: "/bin/codex" });
    expect(broadcaster.status().providers.codex).toEqual({ found: true, path: "/bin/codex" });
    expect(broadcaster.status().claude).toEqual({ found: false });
  });

  test("a status given the old way (claude only) gets its providers", () => {
    const b = new EventBroadcaster(new FakeClock(), {
      claude: { found: true, path: "/c" },
      indexing: { done: 0, total: 0 },
      demo: true,
    });
    expect(b.status().providers).toEqual({ claude: { found: true, path: "/c" } });
  });
});
