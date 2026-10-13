import { describe, expect, test } from "bun:test";
import { type GravitaEvent, GravitaEvent as GravitaEventSchema, keys } from "@gravita/protocol";
import {
  type HookPayload,
  hookSessionStartedKey,
  inputKeyOf,
  mapHook,
  normalizeRecords,
  parseHookPayload,
  type RawRecord,
  stableJson,
} from "../src";

const SID = "44444444-4444-4444-8444-444444444444";
const SUB = "a0000000000000001";
const CTX = { projectId: "p1", ts: "2026-10-13T09:00:00.000Z" };

const common = {
  session_id: SID,
  transcript_path: `/home/u/.claude/projects/-work-demo/${SID}.jsonl`,
  cwd: "/work/demo",
  permission_mode: "default",
};

function hook(raw: Record<string, unknown>): HookPayload {
  const p = parseHookPayload({ ...common, ...raw });
  if (!p) throw new Error(`did not parse: ${JSON.stringify(raw)}`);
  return p;
}

const map = (raw: Record<string, unknown>) => mapHook(hook(raw), CTX);

/** The same tool call as Claude Code records it in the transcript. */
function transcriptOf(
  id: string,
  name: string,
  input: Record<string, unknown>,
  result: { text: string; toolUseResult?: unknown; isError?: boolean },
  agentId = "main",
): GravitaEvent[] {
  const records: RawRecord[] = [
    {
      type: "assistant",
      uuid: "u-a",
      timestamp: CTX.ts,
      message: { id: "msg_1", content: [{ type: "tool_use", id, name, input }] },
    },
    {
      type: "user",
      uuid: "u-r",
      timestamp: CTX.ts,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: id,
            content: result.text,
            ...(result.isError ? { is_error: true } : {}),
          },
        ],
      },
      ...(result.toolUseResult !== undefined ? { toolUseResult: result.toolUseResult } : {}),
    },
  ];
  return normalizeRecords(records, { projectId: "p1", sessionId: SID, agentId, filePath: "/t" });
}

const byKey = (events: GravitaEvent[]) => new Map(events.map((e) => [e.key, e]));

describe("parseHookPayload", () => {
  test("reads only the fields Gravita uses and drops everything else", () => {
    const p = parseHookPayload({
      ...common,
      hook_event_name: "UserPromptSubmit",
      prompt: "secret",
    });
    expect(p).not.toBeNull();
    expect(JSON.stringify(p)).not.toContain("secret");
    expect(JSON.stringify(p)).not.toContain("transcript_path");
  });

  test("events Gravita doesn't read, and payloads without a session, are null", () => {
    expect(parseHookPayload({ ...common, hook_event_name: "PreCompact" })).toBeNull();
    expect(parseHookPayload({ ...common, hook_event_name: "SubagentStart" })).toBeNull();
    expect(parseHookPayload({ hook_event_name: "Stop" })).toBeNull();
    expect(parseHookPayload("Stop")).toBeNull();
  });

  test("a field of an unexpected type is treated as absent", () => {
    const p = parseHookPayload({ ...common, hook_event_name: "PreToolUse", tool_input: "rm -rf" });
    expect(p?.tool_input).toBeUndefined();
  });
});

describe("mapHook", () => {
  test("every event is valid, marked as a hook, and keyed like the transcript", () => {
    const all = [
      map({ hook_event_name: "SessionStart", source: "startup" }),
      map({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_use_id: "toolu_1",
      }),
      map({
        hook_event_name: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_use_id: "toolu_1",
        tool_response: { stdout: "a\nb", stderr: "", interrupted: false },
      }),
    ].flatMap((m) => m.events);
    expect(all).toHaveLength(3);
    for (const e of all) {
      expect(() => GravitaEventSchema.parse(e)).not.toThrow();
      expect(e).toMatchObject({ source: "hook", provider: "claude", projectId: "p1", ts: CTX.ts });
    }
  });

  test("PreToolUse and PostToolUse carry the transcript's keys and data for the same call", () => {
    const input = { file_path: "/work/demo/a.ts", old_string: "a", new_string: "b" };
    const response = {
      filePath: "/work/demo/a.ts",
      structuredPatch: [{ lines: ["-a", "+b", "+c"] }],
    };
    const transcript = byKey(
      transcriptOf("toolu_e", "Edit", input, { text: "Updated", toolUseResult: response }),
    );
    const started = map({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: input,
      tool_use_id: "toolu_e",
    }).events;
    const completed = map({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: input,
      tool_use_id: "toolu_e",
      tool_response: response,
    }).events;

    expect(started.map((e) => e.key)).toEqual([keys.toolStarted("toolu_e")]);
    expect(started[0]?.data).toEqual(transcript.get(keys.toolStarted("toolu_e"))?.data);
    expect(started[0]?.agentId).toBe("main");

    expect(completed.map((e) => e.key)).toEqual([keys.toolCompleted("toolu_e")]);
    const fromTranscript = transcript.get(keys.toolCompleted("toolu_e"));
    expect(completed[0]?.data).toMatchObject({
      toolUseId: "toolu_e",
      ok: true,
      fileChanges: [{ path: "/work/demo/a.ts", added: 2, removed: 1 }],
    });
    expect(fromTranscript?.data).toMatchObject({
      toolUseId: "toolu_e",
      ok: true,
      fileChanges: [{ path: "/work/demo/a.ts", added: 2, removed: 1 }],
    });
    // The hook can't point into the transcript file.
    expect(completed[0]?.data).not.toHaveProperty("outputRef");
  });

  test("a failed call matches the transcript's error result", () => {
    const transcript = byKey(
      transcriptOf("toolu_f", "Bash", { command: "false" }, { text: "Exit code 1", isError: true }),
    );
    const [e] = map({
      hook_event_name: "PostToolUseFailure",
      tool_name: "Bash",
      tool_input: { command: "false" },
      tool_use_id: "toolu_f",
      error: "Exit code 1",
      is_interrupt: false,
    }).events;
    const fromTranscript = transcript.get(keys.toolCompleted("toolu_f"));
    if (fromTranscript?.type !== "tool.completed") throw new Error("missing transcript event");
    const { outputRef: _ref, ...expected } = fromTranscript.data;
    expect(e?.data).toEqual(expected);
  });

  test("an Agent call's result completes the subagent exactly as the transcript does", () => {
    const result = {
      status: "completed",
      agentId: SUB,
      totalTokens: 500,
      totalToolUseCount: 3,
      totalDurationMs: 1200,
      content: [{ type: "text", text: "Found it" }],
    };
    const input = { description: "Find it", prompt: "…", subagent_type: "Explore" };
    const transcript = byKey(
      transcriptOf("toolu_a", "Agent", input, { text: "Found it", toolUseResult: result }),
    );
    const events = map({
      hook_event_name: "PostToolUse",
      tool_name: "Agent",
      tool_input: input,
      tool_use_id: "toolu_a",
      tool_response: result,
    }).events;
    const done = events.find((e) => e.type === "agent.completed");
    expect(done?.key).toBe(keys.agentCompleted(SID, SUB));
    expect(done?.agentId).toBe(SUB);
    expect(done?.data).toEqual(transcript.get(keys.agentCompleted(SID, SUB))?.data);
  });

  test("TodoWrite also updates the todo list, like the transcript", () => {
    const input = { todos: [{ content: "Write tests", status: "in_progress" }] };
    const transcript = byKey(transcriptOf("toolu_t", "TodoWrite", input, { text: "ok" }));
    const events = map({
      hook_event_name: "PreToolUse",
      tool_name: "TodoWrite",
      tool_input: input,
      tool_use_id: "toolu_t",
    }).events;
    const todo = events.find((e) => e.type === "todo.updated");
    expect(todo?.key).toBe("todo:toolu_t");
    expect(todo?.data).toEqual(transcript.get("todo:toolu_t")?.data);
  });

  test("a hook inside a subagent is that subagent's, with the subagent's transcript keys", () => {
    const m = map({
      hook_event_name: "PreToolUse",
      agent_id: SUB,
      agent_type: "Explore",
      tool_name: "Grep",
      tool_input: { pattern: "TODO" },
      tool_use_id: "toolu_s",
    });
    expect(m.agentId).toBe(SUB);
    const transcript = transcriptOf("toolu_s", "Grep", { pattern: "TODO" }, { text: "" }, SUB);
    expect(m.events[0]).toEqual({
      ...(transcript.find((e) => e.type === "tool.started") as GravitaEvent),
      source: "hook",
    });
  });

  test("SessionStart starts an external session under its own key; resume and compact don't", () => {
    const [e] = map({ hook_event_name: "SessionStart", source: "startup" }).events;
    expect(e).toMatchObject({
      key: hookSessionStartedKey(SID),
      type: "session.started",
      agentId: "main",
      data: { kind: "external", cwd: "/work/demo" },
    });
    expect(e?.key).not.toBe(keys.sessionStarted(SID));
    expect(map({ hook_event_name: "SessionStart", source: "clear" }).events).toHaveLength(1);
    expect(map({ hook_event_name: "SessionStart", source: "resume" }).events).toEqual([]);
    expect(map({ hook_event_name: "SessionStart", source: "compact" }).events).toEqual([]);
  });

  test("prompts and turn ends are signals only", () => {
    const req = map({
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "rm x", description: "Remove x" },
    });
    expect(req.events).toEqual([]);
    expect(req.signal).toEqual({
      kind: "prompt",
      via: "request",
      toolName: "Bash",
      inputKey: inputKeyOf("Bash", { description: "Remove x", command: "rm x" }),
      inputPreview: "Remove x",
    });
    expect(
      map({ hook_event_name: "Notification", notification_type: "permission_prompt" }).signal,
    ).toEqual({ kind: "prompt", via: "notification" });
    expect(
      map({ hook_event_name: "Notification", notification_type: "idle_prompt" }).signal,
    ).toBeUndefined();
    expect(map({ hook_event_name: "Stop", stop_hook_active: false }).signal).toEqual({
      kind: "turn-end",
    });
    const sub = map({ hook_event_name: "SubagentStop", agent_id: SUB, agent_type: "Explore" });
    expect([sub.agentId, sub.signal, sub.events]).toEqual([SUB, { kind: "turn-end" }, []]);
    expect(map({ hook_event_name: "SubagentStop" }).signal).toBeUndefined();
    const prompt = map({ hook_event_name: "UserPromptSubmit", prompt: "secret plan" });
    expect(prompt.signal).toEqual({ kind: "turn-end" });
    expect(JSON.stringify(prompt)).not.toContain("secret");
    expect(map({ hook_event_name: "SessionEnd", reason: "clear" }).signal).toEqual({
      kind: "session-end",
    });
  });

  test("the input key ignores key order, and tells different inputs apart", () => {
    expect(stableJson({ b: 1, a: { d: [1, { f: 2, e: 1 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"e":1,"f":2}]},"b":1}',
    );
    expect(inputKeyOf("Bash", { a: 1, b: 2 })).toBe(inputKeyOf("Bash", { b: 2, a: 1 }));
    expect(inputKeyOf("Bash", { a: 1 })).not.toBe(inputKeyOf("Read", { a: 1 }));
    expect(inputKeyOf("Bash", { a: 1 })).not.toBe(inputKeyOf("Bash", { a: 2 }));
  });
});
