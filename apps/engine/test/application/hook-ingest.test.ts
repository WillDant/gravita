import { describe, expect, test } from "bun:test";
import type { EventOf, GravitaEvent } from "@gravita/protocol";
import { HookIngest, RESOLVE_AFTER_MS } from "../../src/application/services/hook-ingest";
import { ProjectionService } from "../../src/application/services/projection-service";
import { InMemorySessionRuntimeRegistry } from "../../src/application/services/session-runtime-registry";
import { AnnounceProject } from "../../src/application/usecases/announce-project";
import { IngestEvents } from "../../src/application/usecases/ingest-events";
import { StopAllSessions } from "../../src/application/usecases/stop-all-sessions";
import { ClaudeHookTranslator } from "../../src/infrastructure/claude/claude-hook-translator";
import {
  FakeClock,
  FakeRuntime,
  MemoryEventStore,
  RecordingPublisher,
  SilentLogger,
} from "../fakes";

const SID = "22222222-2222-4222-8222-222222222222";
const SUB = "a00000000000000a1";
const BASH = { command: "npm test", description: "Run the tests" };

function setup(shared?: { store: MemoryEventStore; projection: ProjectionService }) {
  const clock = new FakeClock();
  const store = shared?.store ?? new MemoryEventStore();
  const projection = shared?.projection ?? new ProjectionService();
  const ingest = new IngestEvents(store, projection, new RecordingPublisher());
  const runtimes = new InMemorySessionRuntimeRegistry(ingest, clock);
  const resolved: string[] = [];
  const projects = new AnnounceProject(
    {
      resolve: async (cwd) => {
        resolved.push(cwd);
        return { id: "p1", root: cwd, name: "demo" };
      },
    },
    ingest,
    clock,
  );
  const logger = new SilentLogger();
  const hooks = new HookIngest({
    translator: new ClaudeHookTranslator(),
    ingest,
    projects,
    ownership: runtimes,
    sessions: projection,
    clock,
    logger,
  });
  const send = (name: string, extra: Record<string, unknown> = {}) =>
    hooks.execute({
      session_id: SID,
      transcript_path: "/home/u/.claude/projects/-work-demo/x.jsonl",
      cwd: "/work/demo",
      permission_mode: "default",
      hook_event_name: name,
      ...extra,
    });
  const ofType = <T extends GravitaEvent["type"]>(type: T) =>
    store.rows.filter((e): e is EventOf<T> => e.type === type);
  const agent = (id = "main") => projection.session(SID)?.agents[id];
  return { clock, store, projection, runtimes, hooks, send, ofType, agent, resolved, logger };
}

const pre = (id: string, tool = "Bash", input: Record<string, unknown> = BASH, more = {}) =>
  ["PreToolUse", { tool_name: tool, tool_input: input, tool_use_id: id, ...more }] as const;
const post = (id: string, tool = "Bash", input: Record<string, unknown> = BASH, more = {}) =>
  [
    "PostToolUse",
    {
      tool_name: tool,
      tool_input: input,
      tool_use_id: id,
      tool_response: { stdout: "ok" },
      ...more,
    },
  ] as const;
const ask = (tool = "Bash", input: Record<string, unknown> = BASH, more = {}) =>
  ["PermissionRequest", { tool_name: tool, tool_input: input, ...more }] as const;

describe("HookIngest: tool facts", () => {
  test("tool hooks become the transcript's tool events, in the cwd's project", async () => {
    const { send, ofType, store, agent, resolved } = setup();
    await send(...pre("toolu_1"));
    expect(agent()?.inflight.toolu_1?.name).toBe("Bash");
    await send(...post("toolu_1"));
    expect(resolved).toEqual(["/work/demo"]);
    expect(store.rows[0]?.type).toBe("project.discovered");
    const [started] = ofType("tool.started");
    expect(started).toMatchObject({
      key: "tool:toolu_1:started",
      source: "hook",
      provider: "claude",
      projectId: "p1",
      sessionId: SID,
      agentId: "main",
      data: { kind: "bash", target: { cmd: "npm test" }, inputPreview: "Run the tests" },
    });
    expect(ofType("tool.completed")[0]?.data).toEqual({
      toolUseId: "toolu_1",
      ok: true,
      outputPreview: "ok",
    });
    expect(agent()?.inflight).toEqual({});
  });

  test("malformed payloads and events Gravita doesn't read are ignored", async () => {
    const { hooks, send, store } = setup();
    await hooks.execute(null);
    await hooks.execute({ hook_event_name: "PreToolUse" });
    await send("PreCompact", { trigger: "auto" });
    await send("Elicitation", {});
    expect(store.rows).toEqual([]);
  });

  test("UserPromptSubmit is only a signal: its prompt text is never stored", async () => {
    const { send, store } = setup();
    await send("UserPromptSubmit", { prompt: "my secret plan" });
    expect(JSON.stringify(store.rows)).not.toContain("secret");
  });

  test("sessions a Gravita runtime owns are left to it", async () => {
    const { send, runtimes, ofType } = setup();
    runtimes.register(new FakeRuntime(SID));
    await send(...pre("toolu_1"));
    await send(...ask());
    expect(ofType("tool.started")).toEqual([]);
    expect(ofType("permission.requested")).toEqual([]);
  });
});

describe("HookIngest: permission prompts", () => {
  test("a prompt makes the agent wait; its call's PostToolUse resolves it as allowed", async () => {
    const { send, ofType, agent, clock } = setup();
    await send(...pre("toolu_1"));
    await send(...ask());
    await send("Notification", { notification_type: "permission_prompt", message: "…" });
    const requested = ofType("permission.requested");
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatchObject({
      key: "perm:hook:toolu_1:requested",
      source: "hook",
      agentId: "main",
      data: {
        requestId: "hook:toolu_1",
        toolUseId: "toolu_1",
        toolName: "Bash",
        inputPreview: "Run the tests",
      },
    });
    expect(agent()?.lifecycle).toBe("waiting_user");
    expect(agent()?.pendingPermissions).toEqual(["hook:toolu_1"]);

    clock.advance(4_000);
    await send(...post("toolu_1"));
    expect(ofType("permission.resolved").map((e) => e.data)).toEqual([
      { requestId: "hook:toolu_1", decision: "allow", by: "hook" },
    ]);
    expect(agent()?.lifecycle).toBe("active");
    expect(agent()?.pendingPermissions).toEqual([]);
  });

  test("the turn ending without the call is a deny; so is the next call, once a person could answer", async () => {
    const { send, ofType, clock } = setup();
    await send(...pre("toolu_1"));
    await send(...ask());
    await send("Stop", {});
    expect(ofType("permission.resolved").map((e) => e.data.decision)).toEqual(["deny"]);

    await send(...pre("toolu_2", "Write", { file_path: "/work/demo/a.ts", content: "x" }));
    await send(...ask("Write", { file_path: "/work/demo/a.ts", content: "x" }));
    // Arrived just after the prompt: reordering, not an answer.
    clock.advance(RESOLVE_AFTER_MS / 2);
    await send(...pre("toolu_3", "Read", { file_path: "/work/demo/b.ts" }));
    expect(ofType("permission.resolved")).toHaveLength(1);
    clock.advance(RESOLVE_AFTER_MS);
    await send(...pre("toolu_4", "Read", { file_path: "/work/demo/c.ts" }));
    expect(ofType("permission.resolved").map((e) => e.data)).toEqual([
      { requestId: "hook:toolu_1", decision: "deny", by: "hook" },
      { requestId: "hook:toolu_2", decision: "deny", by: "hook" },
    ]);
  });

  test("a parallel call ending doesn't end the prompt of another", async () => {
    const { send, ofType, clock } = setup();
    const a = { file_path: "/work/demo/a.ts" };
    const b = { file_path: "/etc/hosts" };
    await send(...pre("toolu_a", "Read", a));
    await send(...pre("toolu_b", "Read", b));
    await send(...ask("Read", b));
    expect(ofType("permission.requested")[0]?.data.toolUseId).toBe("toolu_b");
    clock.advance(5_000);
    await send(...post("toolu_a", "Read", a));
    expect(ofType("permission.resolved")).toEqual([]);
    await send(...post("toolu_b", "Read", b));
    expect(ofType("permission.resolved").map((e) => e.data.decision)).toEqual(["allow"]);
  });

  test("a prompt that arrives before its PreToolUse is tied to that call", async () => {
    const { send, ofType, clock } = setup();
    await send(...ask());
    const [requested] = ofType("permission.requested");
    expect(requested?.data.requestId).toMatch(/^hook:22222222-.+:main:[0-9a-f]{16}$/);
    expect(requested?.data.toolUseId).toBeUndefined();
    await send(...pre("toolu_1"));
    expect(ofType("permission.resolved")).toEqual([]);
    clock.advance(3_000);
    await send(...post("toolu_1"));
    expect(ofType("permission.resolved").map((e) => e.data.decision)).toEqual(["allow"]);
  });

  test("a failed call resolves its prompt as denied", async () => {
    const { send, ofType, clock } = setup();
    await send(...pre("toolu_1"));
    await send(...ask());
    clock.advance(2_000);
    await send("PostToolUseFailure", {
      tool_name: "Bash",
      tool_input: BASH,
      tool_use_id: "toolu_1",
      error: "Exit code 1",
    });
    expect(ofType("tool.completed")[0]?.data).toEqual({
      toolUseId: "toolu_1",
      ok: false,
      outputPreview: "Exit code 1",
      error: "Exit code 1",
    });
    expect(ofType("permission.resolved").map((e) => e.data.decision)).toEqual(["deny"]);
  });

  test("a subagent's prompt is the subagent's; only its own SubagentStop ends it", async () => {
    const { send, ofType, agent } = setup();
    await send(...pre("toolu_s", "Bash", BASH, { agent_id: SUB, agent_type: "Explore" }));
    await send(...ask("Bash", BASH, { agent_id: SUB, agent_type: "Explore" }));
    expect(ofType("permission.requested")[0]?.agentId).toBe(SUB);
    expect(agent(SUB)?.lifecycle).toBe("waiting_user");
    expect(agent()?.lifecycle).not.toBe("waiting_user");
    await send("Stop", {});
    await send("UserPromptSubmit", { prompt: "and?" });
    expect(ofType("permission.resolved")).toEqual([]);
    await send("SubagentStop", { agent_id: SUB, agent_type: "Explore" });
    expect(ofType("permission.resolved")[0]).toMatchObject({
      agentId: SUB,
      data: { requestId: "hook:toolu_s", decision: "deny" },
    });
  });

  test("SessionEnd resolves every agent's prompts", async () => {
    const { send, ofType } = setup();
    await send(...pre("toolu_1"));
    await send(...ask());
    await send(...pre("toolu_s", "Bash", BASH, { agent_id: SUB }));
    await send(...ask("Bash", BASH, { agent_id: SUB }));
    await send("SessionEnd", { reason: "prompt_input_exit" });
    expect(ofType("permission.resolved").map((e) => [e.agentId, e.data.requestId])).toEqual([
      ["main", "hook:toolu_1"],
      [SUB, "hook:toolu_s"],
    ]);
  });

  test("a Notification alone opens the prompt of the agent's open call", async () => {
    const { send, ofType } = setup();
    await send("Notification", { notification_type: "permission_prompt" });
    expect(ofType("permission.requested")).toEqual([]);
    await send(...pre("toolu_1"));
    await send("Notification", { notification_type: "idle_prompt" });
    expect(ofType("permission.requested")).toEqual([]);
    await send("Notification", { notification_type: "permission_prompt" });
    await send(...ask());
    expect(ofType("permission.requested").map((e) => e.data.requestId)).toEqual(["hook:toolu_1"]);
  });

  test("prompts left open across an engine restart are recovered and resolved", async () => {
    const first = setup();
    await first.send(...pre("toolu_1"));
    await first.send(...ask());
    const second = setup({ store: first.store, projection: first.projection });
    await second.send("Stop", {});
    expect(second.ofType("permission.resolved").map((e) => e.data.requestId)).toEqual([
      "hook:toolu_1",
    ]);
    expect(second.agent()?.lifecycle).not.toBe("waiting_user");
  });

  test("spooled hooks never reopen a prompt that is long gone", async () => {
    const { hooks, ofType, clock } = setup();
    const at = (ms: number) => Math.floor(ms / 1_000);
    const base = { session_id: SID, cwd: "/work/demo" };
    await hooks.execute(
      {
        ...base,
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: BASH,
        gravita_spooled_at: at(clock.now() - 10 * 60_000),
      },
      { replay: true },
    );
    await hooks.execute(
      { ...base, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: BASH },
      { replay: true },
    );
    expect(ofType("permission.requested")).toEqual([]);
    await hooks.execute(
      {
        ...base,
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: BASH,
        gravita_spooled_at: at(clock.now() - 5_000),
      },
      { replay: true },
    );
    const [requested] = ofType("permission.requested");
    expect(requested?.ts).toBe(new Date(at(clock.now() - 5_000) * 1_000).toISOString());
  });
});

describe("StopAllSessions", () => {
  test("disposes every runtime, waiting no longer than its cap", async () => {
    const { runtimes, clock, logger } = setup();
    const quick = new FakeRuntime("a");
    const stuck = new FakeRuntime("b");
    stuck.dispose = () => new Promise(() => {});
    runtimes.register(quick);
    runtimes.register(stuck);
    const stop = new StopAllSessions(runtimes, clock, logger, 3_000);
    const done = stop.execute();
    clock.advance(3_000);
    expect(await done).toEqual({ stopped: 2 });
    expect(quick.disposed).toBe(true);
    expect(clock.pendingTimers()).toBe(0);
  });
});
