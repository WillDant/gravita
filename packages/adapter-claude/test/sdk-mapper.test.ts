import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EventOf, GravitaEvent } from "@gravita/protocol";
import { GravitaEvent as GravitaEventSchema } from "@gravita/protocol";
import { conversationOf, parseLines, readSession, SdkSessionMapper } from "../src";

const ROOT = join(import.meta.dir, "../../../fixtures");
const SDK = join(ROOT, "claude-sdk/0.3.296");
const SID = "11111111-1111-4111-8111-111111111111";
const TRANSCRIPT = join(ROOT, `claude/2.1.296/nested-background/${SID}.jsonl`);
const NOW = "2026-10-12T10:05:00.000Z";

function sdkStream(name: string): unknown[] {
  return readFileSync(join(SDK, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as unknown);
}

function mapAll(name: string, sessionId = SID, mapper?: SdkSessionMapper): GravitaEvent[] {
  const m = mapper ?? new SdkSessionMapper({ projectId: "p1", sessionId, now: () => NOW });
  return sdkStream(name).flatMap((msg) => m.map(msg));
}

const byType = <T extends GravitaEvent["type"]>(events: GravitaEvent[], type: T) =>
  events.filter((e): e is EventOf<T> => e.type === type);

/** Fact types both sources report; their keys must be identical. */
const SHARED = new Set<GravitaEvent["type"]>([
  "message.assistant",
  "thinking",
  "tool.started",
  "tool.completed",
  "usage.reported",
  "todo.updated",
  "agent.spawned",
  "agent.completed",
]);

const keyAgents = (events: GravitaEvent[], types: Set<GravitaEvent["type"]>) =>
  new Map(events.filter((e) => types.has(e.type)).map((e) => [e.key, e.agentId]));

describe("SdkSessionMapper", () => {
  test("every event matches the protocol schema and is marked as sdk", () => {
    for (const name of ["nested-background", "question", "auth-failure", "interrupt"]) {
      const events = mapAll(name);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(() => GravitaEventSchema.parse(e)).not.toThrow();
        expect(e.source).toBe("sdk");
      }
    }
  });

  test("task_started spawns subagents with parents, background and depth", () => {
    const spawned = Object.fromEntries(
      byType(mapAll("nested-background"), "agent.spawned").map((e) => [e.agentId, e.data]),
    );
    expect(spawned.a0000000000000001).toMatchObject({
      parentAgentId: "main",
      spawnToolUseId: "toolu_A1",
      agentType: "Explore",
      description: "Explore auth",
      background: false,
      depth: 1,
    });
    expect(spawned.a0000000000000002).toMatchObject({
      parentAgentId: "main",
      agentType: "Plan",
      background: true,
    });
    expect(spawned.a0000000000000003).toMatchObject({
      parentAgentId: "a0000000000000002",
      agentType: "Explore",
      depth: 2,
    });
  });

  test("the parent comes from the Agent call's owner when the SDK names no parent task", () => {
    const m = new SdkSessionMapper({ projectId: "p1", sessionId: SID, now: () => NOW });
    const stream = sdkStream("nested-background").map((msg) => {
      const x = msg as { subtype?: string; parent_task_id?: string };
      if (x.subtype === "task_started") delete x.parent_task_id;
      return msg;
    });
    const events = stream.flatMap((msg) => m.map(msg));
    const nested = byType(events, "agent.spawned").find((e) => e.agentId === "a0000000000000003");
    expect(nested?.data.parentAgentId).toBe("a0000000000000002");
  });

  test("messages are attributed by agent_id, else by the task their tool call started", () => {
    const events = mapAll("nested-background");
    const owner = (toolUseId: string) =>
      byType(events, "tool.started").find((e) => e.data.toolUseId === toolUseId)?.agentId;
    expect(owner("toolu_A1")).toBe("main");
    expect(owner("toolu_G1")).toBe("a0000000000000001");
    expect(owner("toolu_A3")).toBe("a0000000000000002");
    expect(owner("toolu_E1")).toBe("a0000000000000003");
    // user messages carry no agent_id: their parent tool call tells.
    const edit = byType(events, "tool.completed").find((e) => e.data.toolUseId === "toolu_E1");
    expect(edit?.agentId).toBe("a0000000000000003");
    expect(edit?.data.fileChanges).toEqual([
      { path: "/work/demo/src/auth/login.ts", added: 2, removed: 1 },
    ]);
  });

  test("keys are identical to the transcript's for every fact both report", async () => {
    const sdk = mapAll("nested-background");
    const transcript = await readSession(TRANSCRIPT, { projectId: "p1" });
    const a = keyAgents(sdk, SHARED);
    const b = keyAgents(transcript, SHARED);
    expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
    for (const [key, agentId] of a) expect({ key, agentId }).toEqual({ key, agentId: b.get(key) });

    // The first prompt is ingested by Gravita itself (same `user:<uuid>` key), not streamed.
    const users = new Set(["message.user"] as const);
    const sdkUsers = [...keyAgents(sdk, users).keys()].sort();
    const transcriptUsers = [...keyAgents(transcript, users).keys()].filter((k) => k !== "user:u1");
    expect(sdkUsers).toEqual(transcriptUsers.sort());
  });

  test("progress, lifecycle, completion and cost", () => {
    const events = mapAll("nested-background");
    expect(byType(events, "agent.progress")[0]).toMatchObject({
      agentId: "a0000000000000001",
      data: { summary: "Searching for login code", lastToolName: "Grep", totalTokens: 61 },
    });
    expect(byType(events, "agent.lifecycle")).toEqual([
      expect.objectContaining({
        key: `agent:${SID}:a0000000000000002:lifecycle:completed`,
        agentId: "a0000000000000002",
        data: { status: "completed" },
      }),
    ]);
    const done = byType(events, "agent.completed").find((e) => e.agentId === "a0000000000000002");
    expect(done?.data).toMatchObject({ status: "completed", summary: "Migration plan ready" });
    // Same key as the transcript's cost-state record.
    expect(byType(events, "cost.snapshot")).toEqual([
      expect.objectContaining({ key: `cost:${SID}:0.4213`, data: { totalCostUsd: 0.4213 } }),
    ]);
    expect(byType(events, "turn.completed").map((e) => e.key)).toContain(`turn:${SID}:r1`);
  });

  test("mapping is deterministic: the same stream yields the same keys", () => {
    const a = mapAll("nested-background").map((e) => e.key);
    const b = mapAll("nested-background").map((e) => e.key);
    expect(a).toEqual(b);
    const nonUsage = a.filter((k) => !k.startsWith("usage:"));
    const dupes = nonUsage.filter((k, i) => nonUsage.indexOf(k) !== i);
    // A completion reported by both the tool result and the notification shares one key.
    expect(dupes.every((k) => k.startsWith("agent:") && k.endsWith(":completed"))).toBe(true);
  });

  test("an authentication failure is a non-retryable auth error", () => {
    const sid = "33333333-3333-4333-8333-333333333333";
    const errors = byType(mapAll("auth-failure", sid), "error");
    expect(errors).toEqual([
      expect.objectContaining({
        key: "error:auth-m1",
        agentId: "main",
        data: { kind: "auth", message: "Not logged in · Please run /login", retryable: false },
      }),
    ]);
  });

  test("questions and interrupts map like any tool call", () => {
    const q = mapAll("question", "22222222-2222-4222-8222-222222222222");
    expect(byType(q, "tool.started")[0]?.data).toMatchObject({
      name: "AskUserQuestion",
      kind: "ask",
    });
    const i = mapAll("interrupt", "44444444-4444-4444-8444-444444444444");
    expect(byType(i, "tool.completed")[0]?.data).toMatchObject({
      toolUseId: "toolu_B1",
      ok: false,
    });
    expect(byType(i, "turn.completed")[0]?.data).toMatchObject({
      subtype: "error_during_execution",
    });
  });

  test("tasks that aren't subagents are ignored; outputRef needs a transcript path", () => {
    const m = new SdkSessionMapper({
      projectId: "p1",
      sessionId: SID,
      now: () => NOW,
      transcriptPath: (agentId) => `/t/${agentId}.jsonl`,
    });
    expect(
      m.map({
        type: "system",
        subtype: "task_started",
        task_id: "b1x2",
        task_type: "local_bash",
        description: "npm test",
      }),
    ).toEqual([]);
    expect(m.map({ type: "system", subtype: "task_notification", task_id: "b1x2" })).toEqual([]);
    expect(m.map(null)).toEqual([]);
    expect(m.map({ type: "rate_limit_event" })).toEqual([]);
    const [done] = m.map({
      type: "user",
      uuid: "u9",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t9", content: "x" }],
      },
    });
    expect(done).toMatchObject({ data: { outputRef: { path: "/t/main.jsonl", uuid: "u9" } } });
    const [noRef] = mapAll("interrupt", "44444444-4444-4444-8444-444444444444").filter(
      (e) => e.type === "tool.completed",
    );
    expect(noRef && "outputRef" in noRef.data).toBe(false);
  });
});

describe("conversationOf", () => {
  test("main-agent prompts and replies with full text and subagent chips", () => {
    const messages = conversationOf(parseLines(readFileSync(TRANSCRIPT, "utf8")));
    expect(messages.map((m) => [m.role, m.text, m.spawned ?? []])).toEqual([
      ["user", "Map the auth flow and plan the migration", []],
      ["assistant", "", [{ toolUseId: "toolu_A1", agentType: "Explore" }]],
      ["assistant", "", [{ toolUseId: "toolu_A2", agentType: "Plan" }]],
      ["assistant", "While that runs, I'll read the config.", []],
      ["assistant", "Here is the plan.", []],
    ]);
    expect(messages[0]).toMatchObject({ uuid: "u1", ts: "2026-10-12T10:00:00.000Z" });
  });

  test("meta, command echoes, notifications, sidechains and long text", () => {
    const long = "x".repeat(5_000);
    const messages = conversationOf([
      { type: "user", uuid: "a", isMeta: true, message: { content: "meta" } },
      { type: "user", uuid: "b", message: { content: "<command-name>/clear</command-name>" } },
      {
        type: "user",
        uuid: "c",
        message: {
          content:
            "<task-notification><task-id>x</task-id><status>completed</status></task-notification>",
        },
      },
      { type: "user", uuid: "d", isCompactSummary: true, message: { content: "summary" } },
      { type: "user", uuid: "e", isSidechain: true, message: { content: "side" } },
      { type: "user", uuid: "f", message: { content: [{ type: "text", text: long }] } },
      {
        type: "assistant",
        uuid: "g1",
        message: { id: "m", content: [{ type: "text", text: "one" }] },
      },
      {
        type: "assistant",
        uuid: "g2",
        message: { id: "m", content: [{ type: "text", text: "two" }] },
      },
    ]);
    expect(messages.map((m) => [m.uuid, m.text.length])).toEqual([
      ["f", 5_000],
      ["g1", "one\n\ntwo".length],
    ]);
  });
});
