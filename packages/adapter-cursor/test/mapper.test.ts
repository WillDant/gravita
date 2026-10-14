import { describe, expect, test } from "bun:test";
import type { GravitaEvent } from "@gravita/protocol";
import { CursorAcpMapper, cursorSessionId, MASK, maskSecret } from "../src";
import { acpSid, answerWith, connect, playTurn, tick } from "./helpers";

const SENTINEL = "crsr_test_SENTINEL_0123456789abcdef";

const ofType = <T extends GravitaEvent["type"]>(events: GravitaEvent[], type: T) =>
  events.filter((e): e is Extract<GravitaEvent, { type: T }> => e.type === type);

describe("CursorAcpMapper", () => {
  test("a streamed reply is one thought and one message, then the turn's end", async () => {
    const c = connect("streaming-reply", 1);
    const { stopReason } = await playTurn(c, "Summarize the README");
    expect(stopReason).toBe("end_turn");
    expect(c.server.failures).toEqual([]);
    expect(c.events.map((e) => e.type)).toEqual([
      "thinking",
      "message.assistant",
      "turn.completed",
    ]);
    const [message] = ofType(c.events, "message.assistant");
    expect(message?.data.textPreview).toBe("The README describes a demo project with two scripts.");
    expect(message?.data.model).toBe("default[]");
    for (const e of c.events) {
      expect(e.source).toBe("cursor-acp");
      expect(e.provider).toBe("cursor");
      expect(e.sessionId).toBe(cursorSessionId(acpSid(1)));
    }
    expect(ofType(c.events, "turn.completed")[0]?.data).toEqual({});
  });

  test("tools, a plan and an approved command", async () => {
    const c = connect("read-and-command", 2, { onRequest: answerWith("allow_once") });
    await playTurn(c, "List the files in src");
    await c.server.finished;
    expect(c.server.failures).toEqual([]);
    expect(c.events.map((e) => e.type)).toEqual([
      "tool.started",
      "tool.completed",
      "todo.updated",
      "tool.started",
      "tool.completed",
      "message.assistant",
      "turn.completed",
    ]);
    const [read, shell] = ofType(c.events, "tool.started");
    expect(read?.data).toMatchObject({
      toolUseId: `cursor:${acpSid(2)}:tool_read_1`,
      name: "read",
      kind: "read",
      target: { path: "/work/demo/src/index.ts" },
    });
    expect(shell?.data).toMatchObject({ name: "shell", kind: "bash", target: { cmd: "ls src" } });
    const [readDone, shellDone] = ofType(c.events, "tool.completed");
    expect(readDone?.data).toMatchObject({
      ok: true,
      outputPreview: "export { greet } from './greet';",
    });
    expect(readDone?.data.fileChanges).toBeUndefined();
    expect(shellDone?.data).toMatchObject({ ok: true, outputPreview: "greet.ts index.ts" });
    expect(ofType(c.events, "todo.updated")[0]?.data.items).toEqual([
      { content: "Read the sources", status: "completed" },
      { content: "List the files", status: "in_progress" },
    ]);
  });

  test("a rejected edit fails its call and writes no file", async () => {
    const c = connect("edit-permission-deny", 3, { onRequest: answerWith("reject_once") });
    await playTurn(c, "Make greet say hello");
    expect(c.server.failures).toEqual([]);
    const [done] = ofType(c.events, "tool.completed");
    expect(done?.data).toMatchObject({ ok: false, error: "The user rejected the edit." });
    expect(done?.data.fileChanges).toBeUndefined();
  });

  test("a cancelled turn closes its open calls as interrupted", async () => {
    const c = connect("cancel-mid-turn", 4);
    await playTurn(c, "Run the slow tests", "u1", async () => {
      while (!c.events.some((e) => e.type === "tool.started")) await tick();
      c.client.notify("session/cancel", { sessionId: acpSid(4) });
    });
    expect(c.server.failures).toEqual([]);
    expect(c.events.map((e) => e.type)).toEqual([
      "tool.started",
      "tool.completed",
      "turn.completed",
    ]);
    expect(ofType(c.events, "tool.completed")[0]?.data).toMatchObject({
      ok: false,
      error: "Turn interrupted",
    });
    expect(ofType(c.events, "turn.completed")[0]?.data).toEqual({ subtype: "interrupted" });
  });

  test("the key never reaches an event", async () => {
    const c = connect("sentinel-key", 5, { mapper: { redact: maskSecret(SENTINEL) } });
    await playTurn(c, "Print the key");
    expect(c.server.failures).toEqual([]);
    const stored = JSON.stringify(c.events);
    expect(stored).not.toContain(SENTINEL);
    expect(stored).toContain(MASK);
    expect(ofType(c.events, "tool.started")[0]?.data.target.cmd).toBe(`echo ${MASK}`);
    expect(ofType(c.events, "message.assistant")[0]?.data.textPreview).toBe(`The key is ${MASK}.`);
  });

  test("a failed turn ends with an error, masked", () => {
    const m = new CursorAcpMapper({
      projectId: "p1",
      sessionId: cursorSessionId(acpSid(6)),
      acpSessionId: acpSid(6),
      now: () => "2026-10-14T12:00:00.000Z",
      redact: maskSecret(SENTINEL),
    });
    m.beginTurn("u1");
    const out = m.endTurn({ error: `bad key ${SENTINEL}` });
    expect(out.map((e) => e.type)).toEqual(["turn.completed", "error"]);
    expect(out[0]?.data).toEqual({ subtype: "error_during_execution" });
    expect(JSON.stringify(out)).not.toContain(SENTINEL);
  });

  test("mapping the same stream twice gives the same keys", async () => {
    const c = connect("read-and-command", 2, { onRequest: answerWith("allow_once") });
    await playTurn(c, "List the files in src");
    const again = new CursorAcpMapper({
      projectId: "p1",
      sessionId: cursorSessionId(acpSid(2)),
      acpSessionId: acpSid(2),
      model: "default[]",
      mode: "agent",
      now: () => "2026-10-14T13:00:00.000Z",
    });
    const replay = [...again.beginTurn("u1")];
    for (const u of c.updates) replay.push(...again.map(u));
    replay.push(...again.endTurn({ stopReason: "end_turn" }));
    expect(replay.map((e) => e.key)).toEqual(c.events.map((e) => e.key));
    expect(new Set(replay.map((e) => e.key)).size).toBe(replay.length);
  });

  test("an update Gravita doesn't read is skipped, and unknown fields are ignored", () => {
    const unknown: string[] = [];
    const m = new CursorAcpMapper({
      projectId: "p1",
      sessionId: cursorSessionId(acpSid(2)),
      acpSessionId: acpSid(2),
      now: () => "2026-10-14T12:00:00.000Z",
      onUnknown: (w) => unknown.push(w),
    });
    const out = m.map({
      sessionId: acpSid(2),
      update: { sessionUpdate: "usage_update", used: 3 } as never,
    });
    expect(out).toEqual([]);
    expect(unknown).toEqual(["usage_update"]);
  });

  test("mode and model: Gravita's own switch is not recorded, the agent's is", async () => {
    const c = connect("mode-and-model", 7, { mapper: { mode: "plan" } });
    await c.client.initialize({ name: "gravita", version: "test" });
    const session = await c.client.call("session/new", { cwd: "/work/demo", mcpServers: [] });
    await c.client.call("session/set_model", {
      sessionId: session.sessionId,
      modelId: "composer-2.5[fast=true]",
    });
    c.mapper.setModel("composer-2.5[fast=true]");
    await c.client.call("session/set_mode", { sessionId: session.sessionId, modeId: "plan" });
    c.events.push(...c.mapper.beginTurn("u1"));
    const { stopReason } = await c.client.call("session/prompt", {
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "Plan the refactor" }],
    });
    c.events.push(...c.mapper.endTurn({ stopReason }));
    await c.client.call("session/set_mode", { sessionId: session.sessionId, modeId: "ask" });
    c.mapper.setMode("ask");
    await c.client.call("session/set_model", {
      sessionId: session.sessionId,
      modelId: "default[]",
    });
    await c.server.finished;
    while (!c.events.some((e) => e.type === "session.settings")) await tick();
    expect(c.server.failures).toEqual([]);
    expect(ofType(c.events, "message.assistant")[0]?.data.model).toBe("composer-2.5[fast=true]");
    const settings = ofType(c.events, "session.settings");
    expect(settings).toHaveLength(1);
    expect(settings[0]?.data).toEqual({ permissionMode: "default" });
  });

  test("Ask survives as the session's providerMode", () => {
    const m = new CursorAcpMapper({
      projectId: "p1",
      sessionId: cursorSessionId(acpSid(7)),
      acpSessionId: acpSid(7),
      mode: "agent",
      now: () => "2026-10-14T12:00:00.000Z",
    });
    const out = m.map({
      sessionId: acpSid(7),
      update: { sessionUpdate: "current_mode_update", currentModeId: "ask" },
    });
    expect(out[0]?.data).toEqual({ permissionMode: "plan", providerMode: "ask" });
    expect(
      m.map({
        sessionId: acpSid(7),
        update: { sessionUpdate: "current_mode_update", currentModeId: "ask" },
      }),
    ).toEqual([]);
  });

  test("a title from the agent names the session", () => {
    const m = new CursorAcpMapper({
      projectId: "p1",
      sessionId: cursorSessionId(acpSid(1)),
      acpSessionId: acpSid(1),
      now: () => "2026-10-14T12:00:00.000Z",
    });
    const out = m.map({
      sessionId: acpSid(1),
      update: { sessionUpdate: "session_info_update", title: "Summarize README" },
    });
    expect(out[0]).toMatchObject({ type: "session.titled", data: { title: "Summarize README" } });
  });
});
