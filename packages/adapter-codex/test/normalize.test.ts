import { describe, expect, test } from "bun:test";
import { buildLineMap } from "@gravita/core";
import { GravitaEvent, keys } from "@gravita/protocol";
import {
  codexSessionId,
  parseRolloutLines,
  RolloutNormalizer,
  readCodexSession,
  type ThreadContext,
} from "../src";
import {
  ofType,
  project,
  SCENARIOS,
  scenarioEvents,
  scenarioFiles,
  scenarioSession,
} from "./helpers";

const ROOT = (n: number) => `019a2b3c-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

describe("every Codex fixture", () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario}: valid events, Codex provenance, namespaced ids, unique keys`, async () => {
      const events = await scenarioEvents(scenario);
      expect(events.length).toBeGreaterThan(3);
      const keys = new Set<string>();
      for (const e of events) {
        expect(() => GravitaEvent.parse(e)).not.toThrow();
        expect(e.source).toBe("codex-rollout");
        expect(e.provider).toBe("codex");
        expect(keys.has(e.key)).toBe(false);
        keys.add(e.key);
        if (e.type === "usage.limits") continue;
        expect(e.sessionId).toStartWith("codex:");
        expect(e.agentId === "main" || e.agentId?.startsWith("codex:")).toBe(true);
        const d = e.data as Record<string, unknown>;
        // A message a client (Gravita) sent keeps the id the client gave it.
        const clientMessage = e.type === "message.user" && !e.key.startsWith("user:codex:");
        for (const id of ["toolUseId", "messageId", "uuid", "spawnToolUseId"])
          if (d[id] !== undefined && !(clientMessage && id === "uuid"))
            expect(String(d[id])).toStartWith("codex:");
      }
      expect(ofType(events, "session.started")).toHaveLength(1);
    });
  }
});

describe("simple-edit", () => {
  test("a session with its start, prompt, tools, usage and end", async () => {
    const events = await scenarioEvents("simple-edit");
    const [started] = ofType(events, "session.started");
    expect(started?.sessionId).toBe(codexSessionId(ROOT(0x201)));
    expect(started?.data).toEqual({
      kind: "external",
      cwd: "/work/demo",
      gitBranch: "feat/greeting",
      model: "gpt-5.5-codex",
      entrypoint: "codex_exec",
      cliVersion: "0.160.0",
    });
    // Injected context (AGENTS.md, environment) and Codex's instructions are not prompts.
    expect(ofType(events, "message.user").map((e) => e.data.textPreview)).toEqual([
      "Rename the greeting to say hello world",
    ]);
    expect(ofType(events, "message.assistant").map((e) => e.data.textPreview)).toEqual([
      "I'll look at the greeting first.",
      "The greeting now says hello world.",
    ]);
    const tools = ofType(events, "tool.started").map((e) => [
      e.data.name,
      e.data.kind,
      e.data.target,
    ]);
    expect(tools).toEqual([
      ["exec_command", "bash", { cmd: "cat src/greet.ts" }],
      ["apply_patch", "edit", { path: "src/greet.ts" }],
    ]);
    const patch = ofType(events, "tool.completed").find(
      (e) => e.data.toolUseId === "codex:call_patch",
    );
    expect(patch?.data.fileChanges).toEqual([{ path: "src/greet.ts", added: 1, removed: 1 }]);
    expect(ofType(events, "thinking")).toHaveLength(1);
    expect(ofType(events, "turn.completed").map((e) => e.data)).toEqual([{ durationMs: 8000 }]);

    const s = project(events);
    expect(s.provider).toBe("codex");
    expect(s.agents.main?.lifecycle).toBe("idle");
    expect(s.agents.main?.toolCount).toBe(2);
    expect(s.agents.main?.filesTouched).toEqual(["src/greet.ts"]);
    // Input is the uncached part; reasoning is already inside output.
    expect(s.agents.main?.tokens).toEqual({
      input: 1200 + 300 + 50,
      output: 60 + 90 + 25,
      cacheRead: 800 + 1100 + 1400,
      cacheWrite: 0,
    });
  });

  test("records it doesn't know (world_state, token_usage_record, newer types) are ignored", async () => {
    const files = await scenarioFiles("simple-edit");
    const text = await Bun.file(files[0]!.path).text();
    const types = new Set(parseRolloutLines(text).map((r) => r.type));
    expect(types).toContain("world_state");
    expect(types).toContain("future_record_type");
    const ctx: ThreadContext = {
      projectId: "p1",
      sessionId: "codex:x",
      agentId: "main",
      threadId: "x",
      filePath: "/f",
    };
    const unknown = parseRolloutLines(
      [
        JSON.stringify({ type: "future_record_type", payload: { a: 1 } }),
        JSON.stringify({ type: "event_msg", payload: { type: "brand_new_event" } }),
        JSON.stringify({ type: "response_item", payload: { type: "new_item", call_id: 3 } }),
        JSON.stringify({ type: "response_item", payload: "not an object" }),
        JSON.stringify({ type: "event_msg" }),
        JSON.stringify({ payload: {} }),
        "[1,2,3]",
        "{not json",
      ].join("\n"),
    );
    expect(new RolloutNormalizer(ctx).push(unknown)).toEqual([]);
  });
});

describe("exec-and-patch", () => {
  test("tools by kind, a failing command, a 2-file patch and the plan as todos", async () => {
    const events = await scenarioEvents("exec-and-patch");
    const started = ofType(events, "tool.started");
    expect(started.map((e) => [e.data.name, e.data.kind])).toEqual([
      ["update_plan", "todo"],
      ["exec_command", "bash"],
      ["web_search", "web"],
      ["mcp__docs__search", "mcp"],
      ["apply_patch", "edit"],
      ["exec_command", "bash"],
      ["write_stdin", "bash"],
      ["exec", "bash"],
      ["update_plan", "todo"],
    ]);
    expect(started.find((e) => e.data.kind === "web")?.data.target).toEqual({
      query: "express health check endpoint",
    });
    // A code-mode script shows the command it runs, not the script around it.
    expect(started.find((e) => e.data.name === "exec")?.data.target.cmd).toBe("pnpm test");
    const done = new Map(ofType(events, "tool.completed").map((e) => [e.data.toolUseId, e.data]));
    expect(done.size).toBe(started.length);
    expect(done.get("codex:call_test")?.ok).toBe(false);
    expect(done.get("codex:call_test")?.error).toContain("Process exited with code 1");
    expect(done.get("codex:call_rg")?.ok).toBe(true);
    expect(done.get("codex:call_code")?.ok).toBe(true);
    expect(done.get("codex:call_patch")?.fileChanges).toEqual([
      { path: "src/health.ts", added: 3, removed: 0 },
      { path: "src/server.ts", added: 3, removed: 1 },
    ]);
    expect(ofType(events, "todo.updated").map((e) => e.data.items.map((i) => i.status))).toEqual([
      ["in_progress", "pending", "pending"],
      ["completed", "completed", "completed"],
    ]);
    const s = project(events);
    expect(s.agents.main?.filesTouched).toEqual(["src/health.ts", "src/server.ts"]);
    expect(Object.keys(s.agents.main?.inflight ?? {})).toEqual([]);
  });
});

describe("subagents", () => {
  test("two explorers under main, one still running; the guardian is not an agent", async () => {
    const session = await scenarioSession("subagents");
    expect(session.subagents.map((f) => f.meta.threadId)).toEqual([ROOT(0x402), ROOT(0x403)]);
    const events = await readCodexSession(session, { projectId: "p1" });
    const spawned = ofType(events, "agent.spawned");
    expect(spawned.map((e) => [e.agentId, e.data])).toEqual([
      [
        `codex:${ROOT(0x402)}`,
        {
          parentAgentId: "main",
          spawnToolUseId: "codex:call_S1",
          agentType: "explorer",
          description: "Lovelace",
          depth: 1,
          background: false,
        },
      ],
      [
        `codex:${ROOT(0x403)}`,
        {
          parentAgentId: "main",
          spawnToolUseId: "codex:call_S2",
          agentType: "explorer",
          description: "Turing",
          depth: 1,
          background: false,
        },
      ],
    ]);
    expect(events.some((e) => e.agentId === `codex:${ROOT(0x404)}`)).toBe(false);
    expect(
      events.some((e) => e.type === "message.assistant" && e.data.textPreview === "Approved."),
    ).toBe(false);

    const s = project(events);
    expect(s.agents.main?.children.sort()).toEqual([
      `codex:${ROOT(0x402)}`,
      `codex:${ROOT(0x403)}`,
    ]);
    expect(s.agents[`codex:${ROOT(0x402)}`]?.lifecycle).toBe("done");
    expect(s.agents[`codex:${ROOT(0x402)}`]?.summary).toBe("Two route files: users and posts.");
    expect(s.agents[`codex:${ROOT(0x403)}`]?.lifecycle).toBe("active");
    expect(Object.keys(s.agents[`codex:${ROOT(0x403)}`]?.inflight ?? {})).toEqual([
      "codex:call_e2_ls",
    ]);
    // The root's turn is still open: it waits on its explorers.
    expect(s.agents.main?.lifecycle).toBe("active");
    expect(s.agents.main?.lastTool?.name).toBe("wait_agent");
  });
});

describe("aborted-turn", () => {
  test("an interrupt ends the turn; the injected note is not a prompt", async () => {
    const events = await scenarioEvents("aborted-turn");
    expect(ofType(events, "turn.completed").map((e) => e.data)).toEqual([
      { subtype: "interrupted", durationMs: 30000 },
      { durationMs: 7000 },
    ]);
    expect(ofType(events, "message.user").map((e) => e.data.textPreview)).toEqual([
      "Run the full test suite",
      "Just the unit tests, please",
    ]);
    // The interrupted command never gets its output: the turn's end fails it.
    expect(
      ofType(events, "tool.completed").map((e) => [e.data.toolUseId, e.data.ok, e.data.error]),
    ).toEqual([
      ["codex:call_long", false, "Turn interrupted"],
      ["codex:call_unit", true, undefined],
    ]);
    const ends = events.filter((e) => e.type === "tool.completed" || e.type === "turn.completed");
    expect(ends[0]?.type).toBe("tool.completed");
    const s = project(events);
    expect(s.agents.main?.lifecycle).toBe("idle");
    expect(s.agents.main?.inflight).toEqual({});
  });
});

describe("rate-limits", () => {
  test("plan usage from token counts, and usage counted once per response", async () => {
    const events = await scenarioEvents("rate-limits");
    const usage = ofType(events, "usage.reported");
    expect(usage.map((e) => [e.data.input, e.data.output, e.data.cacheRead])).toEqual([
      [1000, 100, 0],
      [50, 20, 1000],
    ]);
    const limits = ofType(events, "usage.limits");
    expect(limits.map((e) => [e.data.window, e.data.usedPercent, e.data.planType])).toEqual([
      ["five_hour", 41.5, "plus"],
      ["seven_day", 63, "plus"],
      ["five_hour", 42, "plus"],
      ["seven_day", 63, "plus"],
      ["seven_day", 9, "team"],
    ]);
    for (const e of limits) {
      expect(e.data.provider).toBe("codex");
      expect(e.sessionId).toBeUndefined();
      expect(e.data.resetsAt).toMatch(/^20\d\d-/);
    }
    expect(project(events).agents.main?.tokens).toEqual({
      input: 1050,
      output: 120,
      cacheRead: 1000,
      cacheWrite: 0,
    });
  });
});

describe("a subagent sent more work", () => {
  const SUB = ROOT(0x9a1);
  const agentId = `codex:${SUB}`;
  const sessionId = codexSessionId(ROOT(0x9a0));
  let clock = 0;
  const rec = (type: string, payload: Record<string, unknown>) =>
    JSON.stringify({
      timestamp: new Date(Date.UTC(2026, 9, 12, 12, 0, clock++)).toISOString(),
      type,
      payload,
    });
  const item = (payload: Record<string, unknown>) => rec("response_item", payload);
  const turn = (id: string, prompt: string, callId: string, reply?: string) => [
    rec("event_msg", { type: "task_started", turn_id: id }),
    rec("turn_context", { turn_id: id, model: "gpt-5.5-codex-mini" }),
    item({ type: "message", role: "user", content: [{ type: "input_text", text: prompt }] }),
    item({
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: `run ${callId}` }),
      call_id: callId,
    }),
    ...(reply
      ? [
          item({
            type: "function_call_output",
            call_id: callId,
            output: "Process exited with code 0",
          }),
          item({
            type: "message",
            role: "assistant",
            id: `msg_${id}`,
            content: [{ type: "output_text", text: reply }],
          }),
        ]
      : []),
  ];
  const lines = parseRolloutLines(
    [
      ...turn("s-turn-1", "Map the routes", "call_1", "Two routes."),
      rec("event_msg", {
        type: "task_complete",
        turn_id: "s-turn-1",
        last_agent_message: "Two routes.",
        duration_ms: 3000,
      }),
      // A follow-up: the second turn's end names no last message.
      ...turn("s-turn-2", "Now map the pages", "call_2", "Three pages."),
      rec("event_msg", { type: "task_complete", turn_id: "s-turn-2", duration_ms: 2000 }),
      // A third turn, interrupted while its command runs.
      ...turn("s-turn-3", "And the tests", "call_3"),
      rec("event_msg", { type: "turn_aborted", turn_id: "s-turn-3", reason: "interrupted" }),
    ].join("\n"),
  );
  const normalize = () =>
    new RolloutNormalizer({
      projectId: "p1",
      sessionId,
      agentId,
      threadId: SUB,
      filePath: "/f",
    }).push(lines);

  test("each turn completes under its own key; the first keeps the key it always had", () => {
    const events = normalize();
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
    const completed = keys.agentCompleted(sessionId, agentId);
    expect(ofType(events, "agent.completed").map((e) => [e.key, e.data])).toEqual([
      [completed, { status: "completed", summary: "Two routes.", durationMs: 3000 }],
      // No last message on the turn's end: its last reply is the summary.
      [`${completed}:s-turn-2`, { status: "completed", summary: "Three pages.", durationMs: 2000 }],
      [`${completed}:s-turn-3`, { status: "stopped" }],
    ]);
    // The later turns wake the subagent up.
    expect(ofType(events, "agent.lifecycle").map((e) => [e.key, e.data])).toEqual([
      [
        keys.agentLifecycle(sessionId, agentId, "running:s-turn-2"),
        { status: "running", resumed: true },
      ],
      [
        keys.agentLifecycle(sessionId, agentId, "running:s-turn-3"),
        { status: "running", resumed: true },
      ],
    ]);
    // The interrupted command fails with its turn, before the turn's end.
    const ends = events.filter((e) => e.type === "tool.completed" || e.type === "agent.completed");
    expect(ends.slice(-2).map((e) => [e.type, e.data])).toEqual([
      ["tool.completed", { toolUseId: "codex:call_3", ok: false, error: "Turn interrupted" }],
      ["agent.completed", { status: "stopped" }],
    ]);
  });

  test("the node is at work during a later turn, and nothing is left in flight", () => {
    const events = normalize();
    const second = events.findIndex(
      (e) => e.type === "tool.started" && e.data.toolUseId === "codex:call_2",
    );
    const upToSecond = events.slice(0, second + 1);
    const during = project(upToSecond).agents[agentId];
    expect(during?.lifecycle).toBe("active");
    expect(Object.keys(during?.inflight ?? {})).toEqual(["codex:call_2"]);
    const lineDuring = buildLineMap(upToSecond).lines.find((l) => l.agentId === agentId);
    expect(lineDuring?.ended).toBe(false);

    const after = project(events).agents[agentId];
    expect(after?.lifecycle).toBe("stopped");
    expect(after?.inflight).toEqual({});
    const line = buildLineMap(events).lines.find((l) => l.agentId === agentId);
    expect(line?.ended).toBe(true);
    expect(line?.stations.at(-1)?.status).toBe("error");
  });
});
