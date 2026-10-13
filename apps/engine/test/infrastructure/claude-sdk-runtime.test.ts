import { describe, expect, test } from "bun:test";
import type { CanUseTool, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatRuntimeSpec } from "../../src/application/ports/chat-runtime";
import { BypassLockedError, NotControllableError } from "../../src/domain/errors";
import { ClaudeSdkRuntime } from "../../src/infrastructure/claude/sdk/claude-sdk-runtime";
import { CLIENT_APP, createCore } from "../../src/main/container";
import { FakeClock, SilentLogger } from "../fakes";
import { type ScriptedQuery, scriptedQueryFn, sdkFixture, settle } from "../sdk-fakes";

const SID = "11111111-1111-4111-8111-111111111111";

function setup(spec: Partial<ChatRuntimeSpec> = {}, disposeTimeoutMs?: number) {
  const logger = new SilentLogger();
  const core = createCore({ dbPath: ":memory:", demo: false, clock: new FakeClock(), logger });
  const { queryFn, queries } = scriptedQueryFn();
  const runtime = new ClaudeSdkRuntime(
    {
      sessionId: SID,
      projectId: "p1",
      cwd: "/work/demo",
      permissionMode: "default",
      environment: { cliPath: "/opt/claude", cliVersion: "2.1.296", env: { PATH: "/usr/bin" } },
      ...spec,
    },
    {
      ingest: core.ingest,
      runtimes: core.runtimes,
      status: core.broadcaster,
      clock: core.clock,
      logger,
      clientApp: CLIENT_APP,
      queryFn,
      ...(disposeTimeoutMs ? { disposeTimeoutMs } : {}),
    },
  );
  core.runtimes.register(runtime);
  runtime.start();
  const q = queries[0] as ScriptedQuery;
  const canUseTool = q.options.canUseTool as CanUseTool;
  const ask = (toolName: string, input: Record<string, unknown>, more = {}) =>
    canUseTool(toolName, input, {
      signal: new AbortController().signal,
      toolUseID: "toolu_X",
      requestId: `req-${toolName}`,
      ...more,
    });
  return { core, runtime, q, queries, logger, ask };
}

const typesOf = (core: ReturnType<typeof setup>["core"]) =>
  [...core.events.allEvents()].map((e) => e.type);

describe("ClaudeSdkRuntime", () => {
  test("bypass is only possible when the session starts in bypass, never switched on later", async () => {
    const normal = setup({ permissionMode: "default" });
    expect(normal.q.options.allowDangerouslySkipPermissions).toBeUndefined();
    await expect(normal.runtime.setPermissionMode("bypassPermissions")).rejects.toBeInstanceOf(
      BypassLockedError,
    );
    await normal.runtime.dispose();

    const bypass = setup({ permissionMode: "bypassPermissions" });
    expect(bypass.q.options.allowDangerouslySkipPermissions).toBe(true);
    await bypass.runtime.dispose();
  });

  test("starts query() in streaming-input mode with Gravita's options", () => {
    const { q, queries } = setup({ model: "sonnet", permissionMode: "acceptEdits" });
    expect(queries).toHaveLength(1);
    const o = q.options;
    expect(o).toMatchObject({
      pathToClaudeCodeExecutable: "/opt/claude",
      cwd: "/work/demo",
      sessionId: SID,
      settingSources: ["user", "project", "local"],
      systemPrompt: { type: "preset", preset: "claude_code" },
      permissionMode: "acceptEdits",
      forwardSubagentText: true,
      agentProgressSummaries: true,
      model: "sonnet",
    });
    expect(o.env).toEqual({
      PATH: "/usr/bin",
      GRAVITA_MANAGED: "1",
      CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP,
    });
    expect(CLIENT_APP).toMatch(/^gravita\/\d+\.\d+\.\d+/);
    expect(o.abortController).toBeInstanceOf(AbortController);
    expect(typeof o.canUseTool).toBe("function");
    expect(typeof q.params.prompt[Symbol.asyncIterator]).toBe("function");
  });

  test("the permission mode is always explicit, and the default model is left to Claude Code", () => {
    const { q } = setup({ model: "default" });
    expect(q.options.permissionMode).toBe("default");
    expect("model" in q.options).toBe(false);
  });

  test("messages go to the SDK with the uuid their event was keyed with", async () => {
    const { runtime, q } = setup();
    await runtime.send("hello", "0b6c6a4e-0000-4000-8000-000000000001");
    await runtime.send("again", "0b6c6a4e-0000-4000-8000-000000000002");
    await q.waitForPrompts(2);
    expect(q.prompts[0]).toEqual({
      type: "user",
      message: { role: "user", content: "hello" },
      parent_tool_use_id: null,
      uuid: "0b6c6a4e-0000-4000-8000-000000000001",
      session_id: SID,
    });
    expect(q.prompts[1]?.uuid).toBe("0b6c6a4e-0000-4000-8000-000000000002");
  });

  test("the stream becomes events: subagents, tools, completion and cost", async () => {
    const { core, q } = setup();
    q.emit(...sdkFixture("nested-background"));
    await settle();
    const s = core.projection.session(SID)!;
    expect(Object.keys(s.agents).sort()).toEqual([
      "a0000000000000001",
      "a0000000000000002",
      "a0000000000000003",
      "main",
    ]);
    expect(s.agents.a0000000000000003?.parentId).toBe("a0000000000000002");
    expect(s.agents.a0000000000000002?.background).toBe(true);
    expect(s.agents.main?.lifecycle).toBe("idle");
    expect(s.costUsd).toBe(0.4213);
    expect([...core.events.allEvents()].every((e) => e.source === "sdk")).toBe(true);
  });

  test("a tool permission waits for the user: allow and deny", async () => {
    const { runtime, core, ask } = setup();
    const allowed = ask("Bash", { command: "ls" }, { requestId: "r1" });
    expect(core.projection.session(SID)!.agents.main!.pendingPermissions).toEqual(["r1"]);
    await runtime.respondPermission("main", "r1", "allow");
    expect(await allowed).toEqual({ behavior: "allow", updatedInput: { command: "ls" } });

    const denied = ask(
      "Write",
      { file_path: "/x" },
      { requestId: "r2", agentID: "a0000000000000001" },
    );
    await expect(runtime.respondPermission("main", "r2", "deny")).rejects.toBeInstanceOf(
      NotControllableError,
    );
    await runtime.respondPermission("a0000000000000001", "r2", "deny");
    expect(await denied).toMatchObject({ behavior: "deny" });
    expect(typesOf(core).filter((t) => t.startsWith("permission."))).toEqual([
      "permission.requested",
      "permission.resolved",
      "permission.requested",
      "permission.resolved",
    ]);
  });

  test("AskUserQuestion is answered through updatedInput.answers", async () => {
    const { runtime, core, ask } = setup();
    const questions = [
      {
        question: "Which database?",
        header: "DB",
        multiSelect: false,
        options: [{ label: "Postgres", description: "" }],
      },
    ];
    const answered = ask("AskUserQuestion", { questions }, { requestId: "q1" });
    expect(Object.keys(core.projection.session(SID)!.agents.main!.questions)).toEqual(["q1"]);
    await runtime.answerQuestion("main", "q1", { "Which database?": "Postgres" });
    expect(await answered).toEqual({
      behavior: "allow",
      updatedInput: { questions, answers: { "Which database?": "Postgres" } },
    });
  });

  test("control: interrupt, stop a subagent, model and mode", async () => {
    const { runtime, q } = setup();
    await runtime.interrupt();
    await runtime.stopAgent("a0000000000000002");
    await runtime.stopAgent("main");
    await runtime.setModel("opus");
    await runtime.setModel("default");
    await runtime.setPermissionMode("plan");
    expect(q.calls).toEqual([
      "interrupt",
      "stopTask:a0000000000000002",
      "interrupt",
      "model:opus",
      "model:<default>",
      "mode:plan",
    ]);
    expect(await runtime.supportedModels()).toEqual([
      { value: "default", displayName: "Default" },
      { value: "opus", displayName: "Opus" },
    ]);
  });

  test("dispose aborts, closes Claude Code, denies what's pending and unregisters", async () => {
    const { runtime, core, q, ask } = setup();
    const pending = ask("Bash", { command: "sleep 9" }, { requestId: "r1" });
    const signal = q.options.abortController!.signal;
    await runtime.dispose();
    expect(signal.aborted).toBe(true);
    expect(q.calls).toContain("close");
    expect(await pending).toMatchObject({ behavior: "deny" });
    expect([...core.events.allEvents()].at(-1)).toMatchObject({
      type: "permission.resolved",
      data: { by: "timeout" },
    });
    expect(core.runtimes.isOwned(SID)).toBe(false);
    expect(core.projection.session(SID)!.controllable).toBe(false);
    await expect(runtime.send("late", "u")).rejects.toBeInstanceOf(NotControllableError);
    await expect(runtime.interrupt()).rejects.toBeInstanceOf(NotControllableError);
    await runtime.dispose();
  });

  test("dispose resolves within its cap even if Claude Code doesn't stop", async () => {
    const { runtime, q } = setup({}, 50);
    q.stuck = true;
    const t = performance.now();
    await runtime.dispose();
    expect(performance.now() - t).toBeLessThan(1_000);
  });

  test("not logged in → loggedIn false and an auth error; a good turn → true", async () => {
    const { core, q } = setup();
    q.emit(...sdkFixture("auth-failure"));
    await settle();
    expect(core.broadcaster.status().claude.loggedIn).toBe(false);
    expect([...core.events.allEvents()].find((e) => e.type === "error")).toMatchObject({
      data: { kind: "auth", retryable: false },
    });
    q.emit({
      type: "result",
      subtype: "success",
      uuid: "r-ok",
      is_error: false,
      total_cost_usd: 0.01,
    } as unknown as SDKMessage);
    await settle();
    expect(core.broadcaster.status().claude.loggedIn).toBe(true);
  });

  test("when the stream ends the runtime unregisters; a crash is reported", async () => {
    const a = setup();
    a.q.end();
    await settle();
    expect(a.core.runtimes.isOwned(SID)).toBe(false);

    const b = setup();
    b.q.fail(new Error("claude exited with code 1"));
    await settle();
    expect(b.core.runtimes.isOwned(SID)).toBe(false);
    expect([...b.core.events.allEvents()].at(-1)).toMatchObject({
      type: "error",
      data: { kind: "runtime", retryable: false },
    });
    expect(b.logger.lines.some((l) => l.includes("stopped"))).toBe(true);
  });

  test("a squad session: tools, guard hook, limits, structured output and resume reach the SDK", async () => {
    const guarded: string[] = [];
    const { q, runtime } = setup({
      kind: "squad",
      squad: { squadId: "q1", roleId: "backend", taskId: "api" },
      permissionMode: "dontAsk",
      systemPromptAppend: "You are Backend.",
      tools: ["Read"],
      disallowedTools: ["Bash"],
      maxBudgetUsd: 2.5,
      maxTurns: 40,
      outputSchema: { type: "object" },
      resume: true,
      env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4" },
      roleTools: [
        {
          name: "whoami",
          description: "who",
          input: {},
          handler: async () => ({ text: "backend" }),
        },
      ],
      toolGuard: (call) => {
        guarded.push(`${call.toolName}:${call.agentId ?? "main"}`);
        return call.toolName === "Bash" ? "no git here" : undefined;
      },
      permissionPolicy: (tool) =>
        tool === "Write" ? "allow" : tool === "WebFetch" ? "deny" : "ask",
    });
    const o = q.options;
    expect(runtime.kind).toBe("squad");
    expect(o).toMatchObject({
      resume: SID,
      permissionMode: "dontAsk",
      systemPrompt: { type: "preset", preset: "claude_code", append: "You are Backend." },
      tools: ["Read"],
      disallowedTools: ["Bash"],
      maxBudgetUsd: 2.5,
      maxTurns: 40,
      outputFormat: { type: "json_schema", schema: { type: "object" } },
    });
    // Resuming continues the session under its own id: no new id is passed.
    expect(o.sessionId).toBeUndefined();
    expect(o.env).toMatchObject({
      PATH: "/usr/bin",
      GRAVITA_MANAGED: "1",
      CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4",
    });
    expect(o.mcpServers?.gravita).toMatchObject({ type: "sdk", name: "gravita" });

    const [matcher] = o.hooks?.PreToolUse ?? [];
    expect(matcher?.matcher).toBe("Edit|Write|MultiEdit|NotebookEdit|Bash");
    const hook = matcher?.hooks[0];
    const pre = (tool: string, agentId?: string) =>
      hook?.(
        {
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: { command: "git commit" },
          tool_use_id: "t",
          session_id: SID,
          transcript_path: "",
          cwd: "/work/demo",
          ...(agentId ? { agent_id: agentId } : {}),
        },
        "t",
        { signal: new AbortController().signal },
      );
    expect(await pre("Bash", "sub-1")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "no git here",
      },
    });
    expect(await pre("Edit")).toEqual({ continue: true });
    expect(guarded).toEqual(["Bash:sub-1", "Edit:main"]);

    const canUseTool = o.canUseTool as CanUseTool;
    const opts = { signal: new AbortController().signal, toolUseID: "t1", requestId: "r1" };
    expect(await canUseTool("Write", { file_path: "a" }, opts)).toEqual({
      behavior: "allow",
      updatedInput: { file_path: "a" },
    });
    expect(await canUseTool("WebFetch", {}, opts)).toMatchObject({ behavior: "deny" });
    await runtime.dispose();
  });

  test("turn outcomes: each result once, in order, then ended", async () => {
    const { q, runtime } = setup();
    const first = runtime.nextTurn();
    q.emit(
      {
        type: "result",
        subtype: "success",
        uuid: "r1",
        is_error: false,
        total_cost_usd: 0.4,
        num_turns: 3,
        structured_output: { goal: "x" },
      } as unknown as SDKMessage,
      {
        type: "result",
        subtype: "error_max_budget_usd",
        uuid: "r2",
        is_error: true,
        total_cost_usd: 1,
        errors: ["over budget"],
      } as unknown as SDKMessage,
    );
    expect(await first).toEqual({
      kind: "result",
      subtype: "success",
      isError: false,
      structuredOutput: { goal: "x" },
      totalCostUsd: 0.4,
      numTurns: 3,
      errors: [],
    });
    expect(await runtime.nextTurn()).toMatchObject({
      subtype: "error_max_budget_usd",
      errors: ["over budget"],
    });
    const pending = runtime.nextTurn();
    q.end();
    expect(await pending).toEqual({ kind: "ended", reason: "closed" });
    expect(await runtime.nextTurn()).toEqual({ kind: "ended", reason: "closed" });

    const b = setup();
    const waiting = b.runtime.nextTurn();
    await b.runtime.dispose();
    expect(await waiting).toEqual({ kind: "ended", reason: "disposed" });
  });
});
