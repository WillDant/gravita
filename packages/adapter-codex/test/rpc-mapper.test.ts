import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { GravitaEvent, keys } from "@gravita/protocol";
import {
  CodexRpcMapper,
  type CodexRpcMapperOptions,
  codexCallId,
  codexSessionId,
  newThreadState,
  parseRolloutLines,
  RolloutNormalizer,
  type ServerNotification,
} from "../src";
import { loadScript } from "../src/testing/scripted-app-server";
import { ofType, scenarioEvents } from "./helpers";

const RPC_FIXTURES = join(import.meta.dir, "../../../fixtures/codex-rpc/0.160");
const thread = (n: number) => `019a2b3c-0000-7000-8000-000000000${n.toString(16)}`;
/** The id Gravita gave the chat's first message (the paired rollout records it). */
const CLIENT_UUID = "00000000-0000-4000-8000-000000000002";

/** What the server sends in a scenario, in order: its notifications. */
function notifications(scenario: string): ServerNotification[] {
  return loadScript(join(RPC_FIXTURES, `${scenario}.jsonl`)).flatMap((s) =>
    s.send ? [s.send as ServerNotification] : [],
  );
}

function mapScenario(
  scenario: string,
  threadNo: number,
  o: Partial<CodexRpcMapperOptions> = {},
): GravitaEvent[] {
  const t = thread(threadNo);
  const mapper = new CodexRpcMapper({
    projectId: "p1",
    sessionId: codexSessionId(t),
    rootThreadId: t,
    model: "gpt-5.5-codex",
    now: () => "2026-10-12T10:00:00.000Z",
    ...o,
  });
  return notifications(scenario).flatMap((n) => mapper.map(n));
}

/** The facts both sources report, by type: what must dedupe. */
const SHARED = [
  "tool.started",
  "tool.completed",
  "message.assistant",
  "thinking",
  "usage.reported",
  "turn.completed",
  "todo.updated",
] as const;

describe("CodexRpcMapper", () => {
  test("the live stream and the rollout key the same facts the same way", async () => {
    const live = mapScenario("command-approval-allow", 0x402);
    const file = await scenarioEvents("app-server-chat");
    for (const type of SHARED) {
      const a = live.filter((e) => e.type === type).map((e) => e.key);
      const b = file.filter((e) => e.type === type).map((e) => e.key);
      expect({ type, keys: a.sort() }).toEqual({ type, keys: b.sort() });
    }
    // Something of each kind is really there.
    expect(ofType(live, "tool.started")).toHaveLength(1);
    expect(ofType(live, "message.assistant")).toHaveLength(1);
    expect(ofType(live, "usage.reported")).toHaveLength(2);
    expect(ofType(live, "turn.completed")).toHaveLength(1);
    // The prompt: Gravita stored it under the id it gave Codex, which the rollout keeps.
    expect(ofType(live, "message.user")).toHaveLength(0);
    expect(ofType(file, "message.user").map((e) => e.key)).toEqual([keys.userMessage(CLIENT_UUID)]);
    // The session: the same key whoever announces it first.
    expect(ofType(file, "session.started")[0]?.key).toBe(
      keys.sessionStarted(codexSessionId(thread(0x402))),
    );
  });

  test("every event is valid, from the live stream, in the session's namespace", () => {
    for (const [scenario, n] of [
      ["streaming-reply", 0x401],
      ["command-approval-allow", 0x402],
      ["file-change-approval-deny", 0x403],
      ["request-user-input", 0x404],
      ["interrupt-mid-turn", 0x405],
      ["steer", 0x406],
      ["process-crash", 0x408],
    ] as const) {
      const events = mapScenario(scenario, n);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(() => GravitaEvent.parse(e)).not.toThrow();
        expect(e.source).toBe("codex-rpc");
        expect(e.provider).toBe("codex");
        if (e.type !== "usage.limits") expect(e.sessionId).toBe(codexSessionId(thread(n)));
      }
      expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
    }
  });

  test("a streamed reply: thinking, the answer, tokens, plan usage and the turn's end", () => {
    const events = mapScenario("streaming-reply", 0x401);
    expect(ofType(events, "thinking")).toHaveLength(1);
    expect(ofType(events, "message.assistant").map((e) => e.data)).toEqual([
      {
        messageId: `codex:${thread(0x401)}:msg_401`,
        textPreview: "It exports greet(), which returns 'hi'.",
        model: "gpt-5.5-codex",
      },
    ]);
    // Codex's input counts cached tokens; Gravita's is the uncached part.
    expect(ofType(events, "usage.reported")[0]?.data).toMatchObject({
      input: 500,
      output: 100,
      cacheRead: 600,
    });
    expect(ofType(events, "usage.limits").map((e) => [e.data.window, e.data.usedPercent])).toEqual([
      ["five_hour", 12],
      ["seven_day", 30],
    ]);
    expect(ofType(events, "turn.completed")[0]?.data).toEqual({ durationMs: 8000 });
  });

  test("an interrupted turn ends as interrupted", () => {
    const events = mapScenario("interrupt-mid-turn", 0x405);
    expect(ofType(events, "tool.started").map((e) => e.data.toolUseId)).toEqual([
      codexCallId("call_sleep"),
    ]);
    expect(ofType(events, "turn.completed")[0]?.data).toEqual({
      subtype: "interrupted",
      durationMs: 3000,
    });
  });

  test("a failed turn reports its error once, keyed by the turn", () => {
    const t = thread(0x409);
    const mapper = new CodexRpcMapper({
      projectId: "p1",
      sessionId: codexSessionId(t),
      rootThreadId: t,
      now: () => "2026-10-12T10:00:00.000Z",
    });
    const turn = {
      id: "turn-x",
      items: [],
      itemsView: "notLoaded",
      startedAt: null,
      completedAt: null,
      durationMs: null,
    };
    mapper.map({
      method: "turn/started",
      params: { threadId: t, turn: { ...turn, status: "inProgress", error: null } },
    } as unknown as ServerNotification);
    const events = mapper.map({
      method: "turn/completed",
      params: {
        threadId: t,
        turn: {
          ...turn,
          status: "failed",
          error: { message: "401 Unauthorized", codexErrorInfo: "unauthorized" },
        },
      },
    } as unknown as ServerNotification);
    expect(events.map((e) => e.type)).toEqual(["error", "turn.completed"]);
    expect(events[0]?.data).toMatchObject({ kind: "turn_failed", message: "401 Unauthorized" });
  });

  test("a file change's paths are known from its item, for the approval card", () => {
    const t = thread(0x403);
    const mapper = new CodexRpcMapper({
      projectId: "p1",
      sessionId: codexSessionId(t),
      rootThreadId: t,
      now: () => "2026-10-12T10:00:00.000Z",
    });
    for (const n of notifications("file-change-approval-deny")) mapper.map(n);
    expect(mapper.fileChangePaths("call_patch")).toEqual(["src/greet.ts"]);
  });

  test("without raw items, the app-server's own items are mapped instead", () => {
    const events = mapScenario("command-approval-allow", 0x402, { rawItems: false });
    expect(ofType(events, "tool.started").map((e) => [e.data.name, e.data.target])).toEqual([
      ["exec_command", { cmd: "ls src" }],
    ]);
    expect(ofType(events, "tool.completed").map((e) => e.data.ok)).toEqual([true]);
    expect(ofType(events, "message.assistant").map((e) => e.data.textPreview)).toEqual([
      "src has two files: greet.ts and index.ts.",
    ]);
    // Turns and tokens don't depend on raw items.
    expect(ofType(events, "turn.completed")).toHaveLength(1);
    expect(ofType(events, "usage.reported")).toHaveLength(2);
  });
});

describe("code mode", () => {
  const scriptMapper = () => {
    const t = thread(0x401);
    const mapper = new CodexRpcMapper({
      projectId: "p1",
      sessionId: codexSessionId(t),
      rootThreadId: t,
      now: () => "2026-10-12T10:00:00.000Z",
    });
    const raw = (item: Record<string, unknown>) =>
      ({
        method: "rawResponseItem/completed",
        params: { threadId: t, turnId: "turn-1", item },
      }) as unknown as ServerNotification;
    /** A script call and its output, mapped. */
    return (callId: string, input: string, output = "Script completed\nOutput:") =>
      [
        raw({
          type: "custom_tool_call",
          status: "completed",
          call_id: callId,
          name: "exec",
          input,
        }),
        raw({ type: "custom_tool_call_output", call_id: callId, output }),
      ].flatMap((n) => mapper.map(n));
  };

  test("a script that applies a patch is an edit of its files", () => {
    const run = scriptMapper();
    const patch =
      "*** Begin Patch\\n*** Add File: src/todo.ts\\n+export const x = 1;\\n*** End Patch";
    const events = run("call_patch", `text(await tools.apply_patch("${patch}"));`);
    expect(ofType(events, "tool.started")[0]?.data).toMatchObject({
      name: "exec",
      kind: "edit",
      target: { path: "src/todo.ts" },
      inputPreview: "src/todo.ts",
    });
    expect(ofType(events, "tool.completed")[0]?.data.fileChanges).toEqual([
      { path: "src/todo.ts", added: 1, removed: 0 },
    ]);
  });

  test("role tools and the web tool keep their kind; several calls are counted", () => {
    const run = scriptMapper();
    const role = run(
      "call_role",
      'text(await tools.mcp__gravita__complete_task({summary:"Built the API"}));',
    );
    expect(ofType(role, "tool.started")[0]?.data).toMatchObject({
      kind: "mcp",
      inputPreview: "mcp__gravita__complete_task",
    });
    const web = run(
      "call_web",
      'const r = await Promise.allSettled([tools.web__run({search_query:[{q:"hono"}]}), tools.exec_command({cmd:"ls"})]);',
    );
    expect(ofType(web, "tool.started")[0]?.data).toMatchObject({
      kind: "web",
      inputPreview: "web__run (+1)",
    });
  });

  test("a script shows its command, and an interrupt fails the call", () => {
    const t = thread(0x401);
    const mapper = new CodexRpcMapper({
      projectId: "p1",
      sessionId: codexSessionId(t),
      rootThreadId: t,
      now: () => "2026-10-12T10:00:00.000Z",
    });
    const raw = (item: Record<string, unknown>) =>
      ({
        method: "rawResponseItem/completed",
        params: { threadId: t, turnId: "turn-1", item },
      }) as unknown as ServerNotification;
    const events = [
      raw({
        type: "custom_tool_call",
        status: "completed",
        call_id: "call_sleep",
        name: "exec",
        input: 'const r = await tools.exec_command({cmd:"sleep 30 && echo finished"});',
      }),
      raw({
        type: "custom_tool_call_output",
        call_id: "call_sleep",
        output: "aborted by user after 3.2s",
      }),
    ].flatMap((n) => mapper.map(n));
    expect(ofType(events, "tool.started")[0]?.data).toMatchObject({
      name: "exec",
      kind: "bash",
      target: { cmd: "sleep 30 && echo finished" },
      inputPreview: "sleep 30 && echo finished",
    });
    expect(ofType(events, "tool.completed")[0]?.data).toMatchObject({
      toolUseId: codexCallId("call_sleep"),
      ok: false,
    });
  });
});

/** A hand-built live stream: notifications for one session, on a clock the test moves. */
function liveSession(root: string, o: Partial<CodexRpcMapperOptions> = {}) {
  let ms = Date.parse("2026-10-12T12:00:00.000Z");
  const mapper = new CodexRpcMapper({
    projectId: "p1",
    sessionId: codexSessionId(root),
    rootThreadId: root,
    model: "gpt-5.5-codex",
    now: () => new Date(ms).toISOString(),
    ...o,
  });
  const send = (method: string, params: Record<string, unknown>) =>
    mapper.map({ method, params } as unknown as ServerNotification);
  const turn = (id: string, status = "inProgress") => ({
    id,
    items: [],
    itemsView: "notLoaded",
    status,
    error: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  });
  return {
    advance: (by: number) => {
      ms += by;
    },
    raw: (threadId: string, item: Record<string, unknown>) =>
      send("rawResponseItem/completed", { threadId, turnId: "t", item }),
    turnStarted: (threadId: string, id: string) =>
      send("turn/started", { threadId, turn: turn(id) }),
    turnCompleted: (threadId: string, id: string) =>
      send("turn/completed", { threadId, turn: turn(id, "completed") }),
    threadStarted: (id: string, parentThreadId: string, role: string, nickname: string) =>
      send("thread/started", {
        thread: { id, parentThreadId, agentRole: role, agentNickname: nickname, path: null },
      }),
  };
}

describe("items without an id of their own", () => {
  const root = thread(0x9b0);
  const items = [
    { type: "reasoning", summary: [], encrypted_content: "gAAAA-synthetic-thought" },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] },
    { type: "web_search_call", status: "completed", action: { type: "search", query: "hono" } },
    { type: "compaction", encrypted_content: "gAAAA-synthetic-summary" },
    { type: "reasoning", summary: [], encrypted_content: null },
    // The same words again later in the turn are another message.
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] },
  ];

  test("get the same keys live and from the rollout, whatever the clocks say", () => {
    const live = liveSession(root);
    const fromLive = [
      ...live.turnStarted(root, "turn-1"),
      ...items.flatMap((item) => {
        live.advance(1_000);
        return live.raw(root, item);
      }),
    ];
    const rollout = parseRolloutLines(
      [
        { type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } },
        { type: "turn_context", payload: { turn_id: "turn-1", model: "gpt-5.5-codex" } },
        ...items.map((payload) => ({ type: "response_item", payload })),
      ]
        .map((r, i) => JSON.stringify({ timestamp: `2026-10-12T09:30:0${i}.123Z`, ...r }))
        .join("\n"),
    );
    const fromFile = new RolloutNormalizer(
      {
        projectId: "p1",
        sessionId: codexSessionId(root),
        agentId: "main",
        threadId: root,
        filePath: "/f",
      },
      { ...newThreadState(), started: true },
    ).push(rollout);
    const shared = [
      "thinking",
      "message.assistant",
      "tool.started",
      "tool.completed",
      "compact.happened",
    ];
    const keysOf = (events: GravitaEvent[]) =>
      events.filter((e) => shared.includes(e.type)).map((e) => e.key);
    expect(keysOf(fromLive)).toHaveLength(7);
    expect(new Set(keysOf(fromLive)).size).toBe(7);
    expect(keysOf(fromLive)).toEqual(keysOf(fromFile));
  });

  test("a compaction record keyed by the summary its replacement history keeps", () => {
    const ctx = {
      projectId: "p1",
      sessionId: codexSessionId(root),
      agentId: "main",
      threadId: root,
      filePath: "/f",
    };
    const compaction = { type: "compaction", encrypted_content: "gAAAA-synthetic-summary" };
    const [item] = new RolloutNormalizer(ctx).push(
      parseRolloutLines(
        JSON.stringify({
          timestamp: "2026-10-12T09:00:00Z",
          type: "response_item",
          payload: compaction,
        }),
      ),
    );
    const [record] = new RolloutNormalizer(ctx).push(
      parseRolloutLines(
        JSON.stringify({
          timestamp: "2026-10-12T09:00:01Z",
          type: "compacted",
          payload: { message: "", replacement_history: [compaction] },
        }),
      ),
    );
    expect(item?.type).toBe("compact.happened");
    expect(record?.key).toBe(item?.key);
  });
});

describe("subagents, live", () => {
  // The `subagents` rollout fixture's session, as the app-server streams it.
  const root = thread(0x401);
  const lovelace = thread(0x402);
  const turing = thread(0x403);
  const spawnCall = (callId: string, message: string) => ({
    type: "function_call",
    name: "spawn_agent",
    arguments: JSON.stringify({ message, agent_type: "explorer" }),
    call_id: callId,
  });
  const spawnOutput = (callId: string, child: string, nickname: string) => ({
    type: "function_call_output",
    call_id: callId,
    output: JSON.stringify({ agent_id: child, nickname }),
  });

  function stream(o: Partial<CodexRpcMapperOptions> = {}) {
    const live = liveSession(root, o);
    const events: GravitaEvent[] = [];
    const at = (step: () => GravitaEvent[]) => {
      live.advance(500);
      events.push(...step());
    };
    at(() => live.turnStarted(root, "turn-1"));
    at(() => live.raw(root, spawnCall("call_S1", "Map the API routes")));
    // The child thread starts before its parent hears back from spawn_agent.
    at(() => live.threadStarted(lovelace, root, "explorer", "Lovelace"));
    at(() => live.turnStarted(lovelace, "e1-turn"));
    at(() =>
      live.raw(lovelace, {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "ls apps/api/routes" }),
        call_id: "call_e1_ls",
      }),
    );
    const beforeLink = events.length;
    at(() => live.raw(root, spawnOutput("call_S1", lovelace, "Lovelace")));
    // The other one: its spawn output comes first.
    at(() => live.raw(root, spawnCall("call_S2", "Map the web pages")));
    at(() => live.raw(root, spawnOutput("call_S2", turing, "Turing")));
    at(() => live.threadStarted(turing, root, "explorer", "Turing"));
    at(() =>
      live.raw(lovelace, {
        type: "function_call_output",
        call_id: "call_e1_ls",
        output: "Process exited with code 0\nOutput:\nusers.ts\nposts.ts",
      }),
    );
    at(() =>
      live.raw(lovelace, {
        type: "message",
        id: "msg_e1",
        role: "assistant",
        content: [{ type: "output_text", text: "Two route files: users and posts." }],
      }),
    );
    at(() => live.turnCompleted(lovelace, "e1-turn"));
    return { events, beforeLink, live };
  }

  test("a spawn names its call, so the conversation's spawn chip links to it", async () => {
    const { events, beforeLink } = stream();
    // Not announced before its call is known; its own events already show it.
    expect(ofType(events.slice(0, beforeLink), "agent.spawned")).toEqual([]);
    expect(events.slice(0, beforeLink).some((e) => e.agentId === `codex:${lovelace}`)).toBe(true);
    const file = await scenarioEvents("subagents");
    const strip = (e: GravitaEvent) => [e.key, e.agentId, e.data];
    expect(ofType(events, "agent.spawned").map(strip)).toEqual(
      ofType(file, "agent.spawned").map(strip),
    );
    expect(ofType(events, "agent.spawned").map((e) => e.data.spawnToolUseId)).toEqual([
      codexCallId("call_S1"),
      codexCallId("call_S2"),
    ]);
  });

  test("a subagent's end carries its last reply, keyed as the rollout keys it", async () => {
    const { events } = stream();
    const file = await scenarioEvents("subagents");
    const done = ofType(events, "agent.completed");
    expect(done.map((e) => [e.key, e.data.status, e.data.summary])).toEqual(
      ofType(file, "agent.completed").map((e) => [e.key, e.data.status, e.data.summary]),
    );
    expect(done[0]?.data.summary).toBe("Two route files: users and posts.");
  });

  test("a spawn whose call never shows is announced unlinked after the grace", () => {
    const live = liveSession(root, { spawnGraceMs: 3_000 });
    expect(live.threadStarted(lovelace, root, "explorer", "Lovelace")).toEqual([]);
    live.advance(1_000);
    expect(ofType(live.turnStarted(lovelace, "e1-turn"), "agent.spawned")).toEqual([]);
    live.advance(2_500);
    const late = ofType(live.turnStarted(root, "turn-1"), "agent.spawned");
    expect(late.map((e) => [e.agentId, e.ts, e.data])).toEqual([
      [
        `codex:${lovelace}`,
        "2026-10-12T12:00:00.000Z",
        {
          parentAgentId: "main",
          agentType: "explorer",
          description: "Lovelace",
          depth: 1,
          background: false,
        },
      ],
    ]);
  });
});
