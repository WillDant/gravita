import { describe, expect, test } from "bun:test";
import { GravitaEvent } from "@gravita/protocol";
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
        for (const id of ["toolUseId", "messageId", "uuid", "spawnToolUseId"])
          if (d[id] !== undefined) expect(String(d[id])).toStartWith("codex:");
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
    expect(started.find((e) => e.data.name === "exec")?.data.target.cmd).toStartWith(
      "const r = await tools.exec_command",
    );
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
    // The interrupted command never completes, and the turn's end clears it.
    expect(ofType(events, "tool.completed").map((e) => e.data.toolUseId)).toEqual([
      "codex:call_unit",
    ]);
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
