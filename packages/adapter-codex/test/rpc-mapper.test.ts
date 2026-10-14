import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { GravitaEvent, keys } from "@gravita/protocol";
import {
  CodexRpcMapper,
  type CodexRpcMapperOptions,
  codexCallId,
  codexSessionId,
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
