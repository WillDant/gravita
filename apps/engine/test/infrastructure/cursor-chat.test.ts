import { describe, expect, test } from "bun:test";
import { type GravitaEvent, RpcErrors } from "@gravita/protocol";
import type { CursorAcpRuntime } from "../../src/infrastructure/cursor/cursor-acp-runtime";
import { call, eventsOf, waitForEvent } from "../codex-rpc-helpers";
import {
  CursorLauncher,
  cursorChatCore,
  cursorScript,
  cursorSessionOf,
  FakeKeyValidator,
  TEST_KEY,
} from "../cursor-helpers";

const CWD = "/work/demo";
const ofType = <T extends GravitaEvent["type"]>(events: GravitaEvent[], type: T) =>
  events.filter((e): e is Extract<GravitaEvent, { type: T }> => e.type === type);

type Core = ReturnType<typeof cursorChatCore>["core"];

function startCursor(core: Core, prompt: string, more: Record<string, unknown> = {}) {
  return call<{ sessionId: string; projectId: string }>(core, "session.start", {
    cwd: CWD,
    prompt,
    provider: "cursor",
    ...more,
  });
}

const runtimeOf = (core: Core, sid: string) => core.runtimes.get(sid) as CursorAcpRuntime;

const rpcError = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e) => e as { code: number; data?: unknown },
  );

describe("Cursor chats through cursor-agent acp", () => {
  test("start and stream a reply, with the key only in the environment", async () => {
    const launcher = new CursorLauncher(cursorScript("streaming-reply"));
    const { core } = cursorChatCore(launcher);
    const sid = cursorSessionOf(1);

    expect(await startCursor(core, "Summarize the README")).toEqual({
      sessionId: sid,
      projectId: `p:${CWD}`,
    });
    const launch = launcher.launches[0]!;
    expect(launch).toMatchObject({ cliPath: "/home/u/.local/bin/cursor-agent", cwd: CWD });
    // The environment is built from scratch: the key pasted in Gravita, nothing of the
    // user's own Cursor login, no other provider's secrets.
    expect(launch.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/u",
      HTTPS_PROXY: "http://proxy.local:3128",
      CURSOR_API_KEY: TEST_KEY,
      AGENT_CLI_CREDENTIAL_STORE: "memory",
      NO_OPEN_BROWSER: "1",
      GRAVITA_MANAGED: "1",
    });
    // Never on the command line.
    expect(JSON.stringify(launch.args ?? [])).not.toContain(TEST_KEY);

    expect(await runtimeOf(core, sid).nextTurn()).toMatchObject({
      kind: "result",
      subtype: "success",
    });
    const server = launcher.servers[0]!;
    await server.finished;
    expect(server.failures).toEqual([]);
    expect(server.sent("authenticate")).toEqual([]);
    const events = eventsOf(core, sid);
    expect(ofType(events, "message.assistant").map((e) => e.data.textPreview)).toEqual([
      "The README describes a demo project with two scripts.",
    ]);
    const conv = await call<{ messages: { role: string; text: string }[] }>(
      core,
      "session.conversation",
      { sessionId: sid },
    );
    expect(conv.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(conv.messages[0]?.text).toBe("Summarize the README");
    expect(conv.messages[1]?.text).toBe(
      "The README describes a demo project with two scripts.",
    );
    // The turn is named by Gravita's user message.
    const user = ofType(events, "message.user")[0]!;
    expect(ofType(events, "turn.completed")[0]?.key).toContain(user.data.uuid);
    expect(core.broadcaster.status().providers.cursor).toMatchObject({
      credential: { source: "app", state: "valid" },
    });
    expect(JSON.stringify(eventsOf(core))).not.toContain(TEST_KEY);

    expect(await call<{ stopped: number }>(core, "engine.stopAll")).toEqual({ stopped: 1 });
    expect(await server.exited).toBe(0);
  });

  test("no key: nothing starts, and the status says the key is missing", async () => {
    const launcher = new CursorLauncher();
    const { core } = cursorChatCore(launcher, { key: null });
    const err = await rpcError(startCursor(core, "Hello"));
    expect(err).toMatchObject({ code: RpcErrors.notLoggedIn.code, data: { provider: "cursor" } });
    expect(launcher.launches).toHaveLength(0);
    expect(core.broadcaster.status().providers.cursor).toMatchObject({
      credential: { source: "none", state: "missing" },
    });
    expect(core.runtimes.all()).toHaveLength(0);
  });

  test("a refused key: not logged in, and the key is marked invalid", async () => {
    const launcher = new CursorLauncher(cursorScript("auth-error"));
    const { core } = cursorChatCore(launcher);
    const err = await rpcError(startCursor(core, "Hello"));
    expect(err).toMatchObject({ code: RpcErrors.notLoggedIn.code, data: { provider: "cursor" } });
    expect(core.broadcaster.status().providers.cursor).toMatchObject({
      credential: { source: "app", state: "invalid" },
    });
    expect(await launcher.servers[0]!.exited).not.toBeUndefined();
  });

  test("Cursor's internal error is told apart by checking the key", async () => {
    const invalid = new FakeKeyValidator("invalid");
    const a = cursorChatCore(new CursorLauncher(cursorScript("invalid-key")), {
      validator: invalid,
    });
    expect(await rpcError(startCursor(a.core, "Hello"))).toMatchObject({
      code: RpcErrors.notLoggedIn.code,
    });
    expect(invalid.seen).toEqual([TEST_KEY]);
    expect(a.core.broadcaster.status().providers.cursor?.credential).toEqual({
      source: "app",
      state: "invalid",
    });

    const offline = new FakeKeyValidator("unchecked");
    const b = cursorChatCore(new CursorLauncher(cursorScript("invalid-key")), {
      validator: offline,
    });
    const err = await rpcError(startCursor(b.core, "Hello"));
    expect(err?.code).toBe(-32603);
    expect(b.logger.lines.join("\n")).not.toContain(TEST_KEY);
  });

  test("an approved command and a plan", async () => {
    const launcher = new CursorLauncher(cursorScript("read-and-command"));
    const { core } = cursorChatCore(launcher);
    const sid = cursorSessionOf(2);
    await startCursor(core, "List the files in src");
    const asked = await waitForEvent(core, (e) => e.type === "permission.requested");
    expect(asked).toMatchObject({
      sessionId: sid,
      agentId: "main",
      data: { toolName: "shell", inputPreview: "ls src", toolUseId: `${sid}:tool_shell_1` },
    });
    const requestId = (asked.data as { requestId: string }).requestId;
    await call(core, "permission.respond", {
      sessionId: sid,
      agentId: "main",
      requestId,
      decision: "allow",
    });
    expect(await runtimeOf(core, sid).nextTurn()).toMatchObject({ subtype: "success" });
    const server = launcher.servers[0]!;
    await server.finished;
    expect(server.failures).toEqual([]);
    const events = eventsOf(core, sid);
    expect(ofType(events, "tool.completed").map((e) => e.data.ok)).toEqual([true, true]);
    expect(ofType(events, "todo.updated")).toHaveLength(1);
    expect(ofType(events, "permission.resolved").map((e) => e.data)).toEqual([
      { requestId, decision: "allow", by: "user" },
    ]);
  });

  test("a denied edit is rejected once, never always", async () => {
    const launcher = new CursorLauncher(cursorScript("edit-permission-deny"));
    const { core } = cursorChatCore(launcher);
    const sid = cursorSessionOf(3);
    await startCursor(core, "Make greet say hello");
    const asked = await waitForEvent(core, (e) => e.type === "permission.requested");
    expect(asked.data).toMatchObject({ toolName: "edit", inputPreview: "/work/demo/src/greet.ts" });
    const requestId = (asked.data as { requestId: string }).requestId;
    await call(core, "permission.respond", {
      sessionId: sid,
      agentId: "main",
      requestId,
      decision: "deny",
    });
    await runtimeOf(core, sid).nextTurn();
    const server = launcher.servers[0]!;
    await server.finished;
    expect(server.failures).toEqual([]);
    expect(ofType(eventsOf(core, sid), "tool.completed")[0]?.data).toMatchObject({ ok: false });
  });

  test("interrupting cancels the turn", async () => {
    const launcher = new CursorLauncher(cursorScript("cancel-mid-turn"));
    const { core } = cursorChatCore(launcher);
    const sid = cursorSessionOf(4);
    await startCursor(core, "Run the slow tests");
    await waitForEvent(core, (e) => e.type === "tool.started");
    await call(core, "session.interrupt", { sessionId: sid });
    expect(await runtimeOf(core, sid).nextTurn()).toMatchObject({ subtype: "interrupted" });
    const server = launcher.servers[0]!;
    await server.finished;
    expect(server.failures).toEqual([]);
    const events = eventsOf(core, sid);
    expect(ofType(events, "tool.completed")[0]?.data).toMatchObject({
      ok: false,
      error: "Turn interrupted",
    });
    expect(ofType(events, "turn.completed")[0]?.data).toEqual({ subtype: "interrupted" });
  });

  test("the key never reaches an event, whatever the agent prints", async () => {
    const launcher = new CursorLauncher(cursorScript("sentinel-key"));
    const { core, logger } = cursorChatCore(launcher);
    const sid = cursorSessionOf(5);
    await startCursor(core, "Print the key");
    await runtimeOf(core, sid).nextTurn();
    await launcher.servers[0]!.finished;
    const stored = JSON.stringify(eventsOf(core));
    expect(stored).not.toContain(TEST_KEY);
    expect(stored).toContain("••••");
    expect(JSON.stringify(core.broadcaster.status())).not.toContain(TEST_KEY);
    expect(logger.lines.join("\n")).not.toContain(TEST_KEY);
  });

  test("a crash ends the session with an error", async () => {
    const launcher = new CursorLauncher(cursorScript("process-crash"));
    const { core } = cursorChatCore(launcher);
    const sid = cursorSessionOf(6);
    await startCursor(core, "Plan the refactor");
    const runtime = runtimeOf(core, sid);
    expect(await runtime.nextTurn()).toEqual({ kind: "ended", reason: "crashed" });
    const events = eventsOf(core, sid);
    expect(ofType(events, "error").map((e) => e.data.message)).toEqual([
      "Cursor stopped unexpectedly",
    ]);
    expect(ofType(events, "turn.completed")).toHaveLength(1);
    expect(core.runtimes.get(sid)).toBeUndefined();
  });

  test("mode and model: set at start, switched later, and the agent's own switch recorded", async () => {
    const launcher = new CursorLauncher(cursorScript("mode-and-model"));
    const { core } = cursorChatCore(launcher);
    const sid = cursorSessionOf(7);
    await startCursor(core, "Plan the refactor", {
      model: "composer-2.5[fast=true]",
      permissionMode: "plan",
    });
    const runtime = runtimeOf(core, sid);
    expect(await runtime.nextTurn()).toMatchObject({ subtype: "success" });
    expect(await call<{ models: unknown[] }>(core, "models.list", { provider: "cursor" })).toEqual({
      models: [
        { value: "default", displayName: "Auto" },
        { value: "composer-2.5[fast=true]", displayName: "Composer 2.5 Fast" },
        { value: "gpt-6.1-sol[]", displayName: "GPT-6.1 Sol" },
      ],
    });
    await call(core, "session.setPermissionMode", { sessionId: sid, mode: "ask" });
    await call(core, "session.setModel", { sessionId: sid, model: "default" });
    await expect(
      call(core, "session.setPermissionMode", { sessionId: sid, mode: "bypassPermissions" }),
    ).rejects.toMatchObject({ code: RpcErrors.badRequest.code });
    const server = launcher.servers[0]!;
    await server.finished;
    await waitForEvent(
      core,
      (e) => e.type === "session.settings" && e.key.includes(":cursor-mode:agent"),
    );
    expect(server.failures).toEqual([]);
    expect(ofType(eventsOf(core, sid), "message.assistant")[0]?.data.model).toBe(
      "composer-2.5[fast=true]",
    );
    // Ask is lossy in Claude's terms: the session keeps Cursor's own mode too.
    const settings = ofType(eventsOf(core, sid), "session.settings").map((e) => e.data);
    expect(settings).toContainEqual({ permissionMode: "plan", providerMode: "ask" });
    expect(core.projection.session(sid)?.permissionMode).toBe("default");
    expect(core.projection.session(sid)?.providerMode).toBeUndefined();
  });

  test("Cursor never runs a squad session, nor a mode of another provider", async () => {
    const { core } = cursorChatCore(new CursorLauncher());
    const { factory, environment } = await core.providers!.ready("cursor");
    const spec = {
      sessionId: "s1",
      projectId: "p1",
      provider: "cursor" as const,
      cwd: CWD,
      permissionMode: "agent" as const,
      environment,
    };
    expect(() => factory.create({ ...spec, kind: "squad" })).toThrow("Cursor runs chats only");
    expect(() => factory.create({ ...spec, permissionMode: "dontAsk" })).toThrow();
    expect(() => factory.create({ ...spec, permissionMode: "fullAccess" })).toThrow();
    expect(
      await rpcError(startCursor(core, "Hi", { permissionMode: "bypassPermissions" })),
    ).toMatchObject({
      code: RpcErrors.badRequest.code,
    });
  });
});

describe("the Cursor key's state", () => {
  test("cursorKey.validate checks the key and answers only its state", async () => {
    const { core, validator } = cursorChatCore(new CursorLauncher());
    expect(await call<unknown>(core, "cursorKey.validate", {})).toEqual({ source: "app", state: "valid" });
    expect(validator.seen).toEqual([TEST_KEY]);
    validator.answer = "invalid";
    expect(await call<unknown>(core, "cursorKey.validate")).toEqual({ source: "app", state: "invalid" });
    expect(core.broadcaster.status().providers.cursor?.credential).toEqual({
      source: "app",
      state: "invalid",
    });
  });

  test("without a key: missing, and nothing is checked", async () => {
    const { core, validator } = cursorChatCore(new CursorLauncher(), { key: null });
    expect(await call<unknown>(core, "cursorKey.validate")).toEqual({ source: "none", state: "missing" });
    expect(validator.seen).toEqual([]);
  });

  test("a new key is unchecked at once, then checked; removing it makes it missing", async () => {
    const validator = new FakeKeyValidator("valid");
    const { core, credentials } = cursorChatCore(new CursorLauncher(), { key: null, validator });
    credentials.setCursorKey("crsr_new_key_0000");
    expect(core.broadcaster.status().providers.cursor?.credential).toEqual({
      source: "app",
      state: "unchecked",
    });
    await Bun.sleep(5);
    expect(core.broadcaster.status().providers.cursor?.credential).toEqual({
      source: "app",
      state: "valid",
    });
    credentials.setCursorKey(null);
    expect(core.broadcaster.status().providers.cursor?.credential).toEqual({
      source: "none",
      state: "missing",
    });
  });

  test("an answer about a key that changed meanwhile is dropped", async () => {
    let release!: (v: "invalid") => void;
    const slow = {
      seen: [] as string[],
      validate: (key: string) => {
        slow.seen.push(key);
        return new Promise<"invalid">((r) => {
          release = r;
        });
      },
    };
    const { core, credentials } = cursorChatCore(new CursorLauncher(), {
      validator: slow as unknown as FakeKeyValidator,
    });
    const first = call<unknown>(core, "cursorKey.validate");
    credentials.setCursorKey(null);
    release("invalid");
    expect(await first).toEqual({ source: "none", state: "missing" });
    expect(core.broadcaster.status().providers.cursor?.credential).toEqual({
      source: "none",
      state: "missing",
    });
  });
});
