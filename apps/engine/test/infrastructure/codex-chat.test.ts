import { describe, expect, test } from "bun:test";
import type { ScriptStep } from "@gravita/adapter-codex/testing";
import { type GravitaEvent, RpcErrors } from "@gravita/protocol";
import type { CodexAppServerRuntime } from "../../src/infrastructure/codex/codex-app-server-runtime";
import { codexTails, installFixture } from "../codex-helpers";
import {
  call,
  codexChatCore,
  eventsOf,
  PROBE_SCRIPT,
  ScriptedLauncher,
  script,
  sessionOf,
  waitForEvent,
} from "../codex-rpc-helpers";
import { FakeRuntime } from "../fakes";
import { withTempDir } from "../helpers";

const CWD = "/work/demo";
const ofType = <T extends GravitaEvent["type"]>(events: GravitaEvent[], type: T) =>
  events.filter((e): e is Extract<GravitaEvent, { type: T }> => e.type === type);

/** Starts a Codex chat through the RPC router. */
async function startCodex(
  core: ReturnType<typeof codexChatCore>["core"],
  prompt: string,
  more: Record<string, unknown> = {},
) {
  return call<{ sessionId: string; projectId: string }>(core, "session.start", {
    cwd: CWD,
    prompt,
    provider: "codex",
    ...more,
  });
}

const runtimeOf = (core: ReturnType<typeof codexChatCore>["core"], sid: string) =>
  core.runtimes.get(sid) as CodexAppServerRuntime;

describe("Codex chats through the app-server", () => {
  test("start, stream, allow a command, end; then the rollout adds nothing twice", async () => {
    const launcher = new ScriptedLauncher(script("command-approval-allow"));
    const { core } = codexChatCore(launcher);
    const sid = sessionOf(0x402);

    const started = await startCodex(core, "List the files in src");
    expect(started).toEqual({ sessionId: sid, projectId: `p:${CWD}` });
    const server = launcher.servers[0]!;
    // The user's own codex, in the folder, with the allowlisted env and their CODEX_HOME.
    expect(launcher.launches[0]).toMatchObject({ cliPath: "/opt/homebrew/bin/codex", cwd: CWD });
    expect(launcher.launches[0]?.env).toMatchObject({
      CODEX_HOME: "/home/u/.codex",
      OPENAI_BASE_URL: "https://proxy.local",
      GRAVITA_MANAGED: "1",
    });
    expect(server.sent("initialize")[0]?.params).toMatchObject({
      clientInfo: { name: "gravita", title: "Gravita" },
    });
    // "Ask before acting": read-only, asks on request; the message carries Gravita's id.
    expect(server.sent("thread/start")[0]?.params).toMatchObject({
      cwd: CWD,
      approvalPolicy: "on-request",
      sandbox: "read-only",
      experimentalRawEvents: true,
    });
    const userMessage = ofType(eventsOf(core, sid), "message.user")[0]!;
    expect(server.sent("turn/start")[0]?.params).toMatchObject({
      clientUserMessageId: userMessage.data.uuid,
    });

    const asked = await waitForEvent(core, (e) => e.type === "permission.requested");
    expect(asked).toMatchObject({
      sessionId: sid,
      agentId: "main",
      data: { toolName: "exec_command", inputPreview: "ls src", toolUseId: "codex:call_ls" },
    });
    const requestId = (asked.data as { requestId: string }).requestId;
    await call(core, "permission.respond", {
      sessionId: sid,
      agentId: "main",
      requestId,
      decision: "allow",
    });
    expect(await runtimeOf(core, sid).nextTurn()).toMatchObject({
      kind: "result",
      subtype: "success",
    });
    await server.finished;
    expect(server.failures).toEqual([]);

    const live = eventsOf(core, sid);
    expect(ofType(live, "tool.completed").map((e) => e.data.ok)).toEqual([true]);
    expect(ofType(live, "message.assistant").map((e) => e.data.textPreview)).toEqual([
      "src has two files: greet.ts and index.ts.",
    ]);
    expect(ofType(live, "permission.resolved").map((e) => e.data)).toEqual([
      { requestId, decision: "allow", by: "user" },
    ]);
    // Logged in, as the account read said.
    expect(core.broadcaster.status().providers.codex).toMatchObject({
      loggedIn: true,
      account: { authMode: "chatgpt", planType: "plus" },
    });

    // The kill switch ends it; the tailer may take the session over.
    expect(await call<{ stopped: number }>(core, "engine.stopAll")).toEqual({ stopped: 1 });
    expect(core.runtimes.all()).toHaveLength(0);
    expect(await server.exited).toBe(0);
    const before = live.length;

    await withTempDir(async (home) => {
      await installFixture(home, "app-server-chat", core.clock.now());
      const { tails } = codexTails({ codexHome: home, core });
      await tails.discover();
    });
    const all = eventsOf(core, sid);
    const count = (type: GravitaEvent["type"]) => ofType(all, type).length;
    expect(count("session.started")).toBe(1);
    expect(count("message.user")).toBe(1);
    expect(count("thinking")).toBe(1);
    expect(count("tool.started")).toBe(1);
    expect(count("tool.completed")).toBe(1);
    expect(count("message.assistant")).toBe(1);
    expect(count("usage.reported")).toBe(2);
    expect(count("turn.completed")).toBe(1);
    // Only what the stream doesn't carry came from the file (the presence it reads).
    expect(all.slice(before).every((e) => e.source === "codex-rollout")).toBe(true);
    expect(all.slice(before).map((e) => e.type)).not.toContain("tool.started");
  });

  test("a denied file change is declined to Codex, and its card names the file", async () => {
    const launcher = new ScriptedLauncher(script("file-change-approval-deny"));
    const { core } = codexChatCore(launcher);
    const sid = sessionOf(0x403);
    await startCodex(core, "Make greet say hello");
    const asked = await waitForEvent(core, (e) => e.type === "permission.requested");
    expect(asked.data).toMatchObject({ toolName: "apply_patch", inputPreview: "src/greet.ts" });
    const requestId = (asked.data as { requestId: string }).requestId;
    await call(core, "permission.respond", {
      sessionId: sid,
      agentId: "main",
      requestId,
      decision: "deny",
    });
    await runtimeOf(core, sid).nextTurn();
    await launcher.servers[0]!.finished;
    expect(launcher.servers[0]!.failures).toEqual([]);
    expect(ofType(eventsOf(core, sid), "tool.completed")[0]?.data.ok).toBe(false);
    await core.disposeRuntimes();
  });

  test("a question from Codex is answered from Gravita", async () => {
    const launcher = new ScriptedLauncher(script("request-user-input"));
    const { core } = codexChatCore(launcher);
    const sid = sessionOf(0x404);
    await startCodex(core, "Add a database");
    const asked = await waitForEvent(core, (e) => e.type === "question.asked");
    expect(asked.data).toMatchObject({
      questions: [
        {
          question: "Which database should I use?",
          header: "Database",
          options: [{ label: "SQLite" }, { label: "Postgres" }],
        },
      ],
    });
    await call(core, "question.answer", {
      sessionId: sid,
      agentId: "main",
      requestId: (asked.data as { requestId: string }).requestId,
      answers: { "Which database should I use?": "SQLite" },
    });
    await runtimeOf(core, sid).nextTurn();
    await launcher.servers[0]!.finished;
    expect(launcher.servers[0]!.failures).toEqual([]);
    await core.disposeRuntimes();
  });

  test("interrupt stops the running turn", async () => {
    const launcher = new ScriptedLauncher(script("interrupt-mid-turn"));
    const { core } = codexChatCore(launcher);
    const sid = sessionOf(0x405);
    await startCodex(core, "Run the slow tests");
    await waitForEvent(core, (e) => e.type === "tool.started");
    await call(core, "session.interrupt", { sessionId: sid });
    expect(await runtimeOf(core, sid).nextTurn()).toMatchObject({ subtype: "interrupted" });
    expect(ofType(eventsOf(core, sid), "turn.completed")[0]?.data).toMatchObject({
      subtype: "interrupted",
    });
    expect(launcher.servers[0]!.failures).toEqual([]);
    await core.disposeRuntimes();
  });

  test("a message during a turn steers it, keyed with its own id", async () => {
    const launcher = new ScriptedLauncher(script("steer"));
    const { core } = codexChatCore(launcher);
    const sid = sessionOf(0x406);
    await startCodex(core, "Write the README");
    await waitForEvent(core, (e) => e.type === "thinking");
    await call(core, "session.send", { sessionId: sid, text: "Keep it short" });
    await runtimeOf(core, sid).nextTurn();
    const server = launcher.servers[0]!;
    await server.finished;
    expect(server.failures).toEqual([]);
    const messages = ofType(eventsOf(core, sid), "message.user");
    expect(messages.map((e) => e.data.textPreview)).toEqual(["Write the README", "Keep it short"]);
    expect(server.sent("turn/steer")[0]?.params).toMatchObject({
      clientUserMessageId: messages[1]?.data.uuid,
    });
    expect(server.sent("turn/start")).toHaveLength(1);
    await core.disposeRuntimes();
  });

  test("Codex not logged in: the chat doesn't start, the app-server is stopped, the UI is told", async () => {
    const launcher = new ScriptedLauncher(script("auth-error"));
    const { core } = codexChatCore(launcher);
    const err = await startCodex(core, "hello").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: RpcErrors.notLoggedIn.code, data: { provider: "codex" } });
    expect(core.runtimes.all()).toHaveLength(0);
    expect(await launcher.servers[0]!.exited).toBe(0);
    expect(core.broadcaster.status().providers.codex?.loggedIn).toBe(false);
    // Nothing of the session was stored.
    expect(eventsOf(core).filter((e) => e.sessionId)).toHaveLength(0);
  });

  test("a crashed app-server ends the session with an error and frees its slot", async () => {
    const launcher = new ScriptedLauncher(script("process-crash"));
    const { core } = codexChatCore(launcher);
    const sid = sessionOf(0x408);
    await startCodex(core, "Refactor everything");
    // The script dies right after the turn starts, whenever the test looks.
    await waitForEvent(core, (e) => e.type === "error" && e.sessionId === sid);
    expect(core.runtimes.all()).toHaveLength(0);
    const errors = ofType(eventsOf(core, sid), "error");
    expect(errors.map((e) => e.data.message)).toEqual(["Codex stopped unexpectedly"]);
    await expect(
      call(core, "session.send", { sessionId: sid, text: "again" }),
    ).rejects.toMatchObject({ code: RpcErrors.notControllable.code });
  });
});

/** streaming-reply, then a second turn that must carry the settings changed in between. */
function twoTurns(secondTurn: Record<string, unknown>, sandbox = "read-only"): ScriptStep[] {
  const steps = script("streaming-reply").map((s) =>
    s.expect?.method === "thread/start"
      ? { ...s, expect: { ...s.expect, params: { ...(s.expect.params as object), sandbox } } }
      : s,
  );
  const t = "019a2b3c-0000-7000-8000-000000000401";
  const turn = (status: string) => ({
    id: "turn-2",
    items: [],
    itemsView: "notLoaded",
    status,
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  });
  return [
    ...steps,
    {
      expect: { method: "turn/start", params: { threadId: t, ...secondTurn } },
      result: { turn: turn("inProgress") },
    },
    { send: { method: "turn/started", params: { threadId: t, turn: turn("inProgress") } } },
    { send: { method: "turn/completed", params: { threadId: t, turn: turn("completed") } } },
  ];
}

describe("Codex chat settings", () => {
  test("model and mode changes ride on the next turn; the session records them", async () => {
    const launcher = new ScriptedLauncher(
      twoTurns({
        model: "gpt-5.5-mini",
        approvalPolicy: "on-request",
        sandboxPolicy: { type: "workspaceWrite", writableRoots: [CWD], networkAccess: false },
      }),
    );
    const { core } = codexChatCore(launcher);
    const sid = sessionOf(0x401);
    await startCodex(core, "What does greet.ts export?");
    const runtime = runtimeOf(core, sid);
    await runtime.nextTurn();
    await call(core, "session.setModel", { sessionId: sid, model: "gpt-5.5-mini" });
    await call(core, "session.setPermissionMode", { sessionId: sid, mode: "workspace" });
    await call(core, "session.send", { sessionId: sid, text: "Now in a sentence" });
    await runtime.nextTurn();
    await launcher.servers[0]!.finished;
    expect(launcher.servers[0]!.failures).toEqual([]);
    // Settings are stored in Claude's terms (workspace ↔ acceptEdits).
    expect(ofType(eventsOf(core, sid), "session.settings").map((e) => e.data)).toContainEqual({
      permissionMode: "acceptEdits",
    });
    await core.disposeRuntimes();
  });

  test("full access only when the chat started with it, and Claude's modes are refused", async () => {
    const launcher = new ScriptedLauncher(
      script("streaming-reply"),
      twoTurns({}, "danger-full-access"),
    );
    const { core } = codexChatCore(launcher);
    await expect(startCodex(core, "hi", { permissionMode: "acceptEdits" })).rejects.toMatchObject({
      code: RpcErrors.badRequest.code,
    });
    expect(launcher.launches).toHaveLength(0);

    await startCodex(core, "What does greet.ts export?");
    const ask = sessionOf(0x401);
    const locked = await call(core, "session.setPermissionMode", {
      sessionId: ask,
      mode: "fullAccess",
    }).catch((e: unknown) => e);
    expect(locked).toMatchObject({ message: expect.stringContaining("only be chosen when") });
    await expect(
      call(core, "session.setPermissionMode", { sessionId: ask, mode: "bypassPermissions" }),
    ).rejects.toBeDefined();
    await core.disposeRuntimes();

    await startCodex(core, "What does greet.ts export?", { permissionMode: "fullAccess" });
    expect(launcher.servers[1]!.sent("thread/start")[0]?.params).toMatchObject({
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    });
    await call(core, "session.setPermissionMode", { sessionId: ask, mode: "ask" });
    await call(core, "session.setPermissionMode", { sessionId: ask, mode: "fullAccess" });
    await core.disposeRuntimes();
  });

  test("Codex chats count toward the six chats, and the kill switch stops them", async () => {
    const launcher = new ScriptedLauncher(script("streaming-reply"), script("streaming-reply"));
    const { core } = codexChatCore(launcher);
    for (let i = 0; i < 5; i++) core.runtimes.register(new FakeRuntime(`chat-${i}`));
    await startCodex(core, "What does greet.ts export?");
    const err = await startCodex(core, "one more").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: RpcErrors.tooManySessions.code });
    expect(launcher.launches).toHaveLength(1);
    expect(await call<{ stopped: number }>(core, "engine.stopAll")).toEqual({ stopped: 6 });
    expect(await launcher.servers[0]!.exited).toBe(0);
  });

  test("models come from the running chat, else from the account probe", async () => {
    const launcher = new ScriptedLauncher(script("streaming-reply"));
    const probe = new ScriptedLauncher(PROBE_SCRIPT);
    const { core } = codexChatCore(launcher, probe);
    // No chat yet: a short-lived app-server is asked (handshake and reads, no thread).
    const before = await call<{ models: unknown[] }>(core, "models.list", { provider: "codex" });
    expect(before.models).toEqual([
      { value: "gpt-5.5-codex", displayName: "GPT-5.5-Codex" },
      { value: "gpt-5.5-mini", displayName: "GPT-5.5-Mini" },
    ]);
    expect(probe.servers[0]!.received.map((m) => m.method)).not.toContain("thread/start");
    expect(await probe.servers[0]!.exited).toBe(0);
    await startCodex(core, "What does greet.ts export?");
    const during = await call<{ models: unknown[] }>(core, "models.list", { provider: "codex" });
    expect(during.models).toHaveLength(2);
    expect(launcher.servers[0]!.sent("model/list")).toHaveLength(1);
    await core.disposeRuntimes();
  });

  test("plan usage is read through the running chat's app-server", async () => {
    const launcher = new ScriptedLauncher(script("streaming-reply"));
    const { core } = codexChatCore(launcher);
    await startCodex(core, "What does greet.ts export?");
    // Plan usage readings are ephemeral (projected, never stored): watch them go by.
    const seen: GravitaEvent[] = [];
    core.ingest.onAccepted((events) => seen.push(...events));
    await call(core, "usage.refresh", { provider: "codex" });
    for (let i = 0; i < 100 && !seen.some((e) => e.source === "gravita"); i++) await Bun.sleep(5);
    const read = seen.filter((e) => e.type === "usage.limits" && e.source === "gravita");
    expect(read.map((e) => e.data)).toEqual([
      expect.objectContaining({ provider: "codex", window: "five_hour", usedPercent: 12 }),
      expect.objectContaining({ provider: "codex", window: "seven_day", usedPercent: 30 }),
    ]);
    expect(core.projection.snapshot().state.usage).toHaveProperty(["codex:five_hour"]);
    expect(launcher.servers[0]!.sent("account/rateLimits/read")).toHaveLength(1);
    expect(core.broadcaster.status().providers.codex?.account?.plan).toBe("limited");
    await core.disposeRuntimes();
  });
});
