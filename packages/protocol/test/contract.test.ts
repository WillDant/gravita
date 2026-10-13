import { describe, expect, test } from "bun:test";
import { Methods } from "../src/constants";
import { EPHEMERAL_EVENT_TYPES, GravitaEvent } from "../src/events";
import { projectDiscoveredEvent } from "../src/factories";
import { RpcContract } from "../src/rpc";

describe("RpcContract", () => {
  test("covers every request method the clients can call", () => {
    for (const method of Object.values(Methods)) expect(method in RpcContract).toBe(true);
  });

  test("validates permission answers", () => {
    const schema = RpcContract["permission.respond"].params;
    const ok = { sessionId: "s", agentId: "main", requestId: "r", decision: "allow" };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, decision: "maybe" }).success).toBe(false);
  });
});

describe("events", () => {
  test("presence, detach and control are ephemeral; facts are not", () => {
    expect([...EPHEMERAL_EVENT_TYPES].sort()).toEqual([
      "session.control",
      "session.detached",
      "session.presence",
    ]);
    expect(EPHEMERAL_EVENT_TYPES.has("tool.started")).toBe(false);
  });

  test("project.discovered is built one way, with a stable key", () => {
    const e = projectDiscoveredEvent(
      { id: "p1", root: "/w/app", name: "app" },
      "2026-10-12T00:00:00Z",
      {
        source: "gravita",
        provider: "claude",
      },
    );
    expect(GravitaEvent.parse(e)).toEqual(e);
    expect(e.key).toBe("project:p1:discovered");
  });
});

describe("M1b contract", () => {
  test("session.start requires a folder and a prompt; mode is one of the known ones", () => {
    const p = RpcContract["session.start"].params;
    expect(p.safeParse({ cwd: "/w/app", prompt: "hi" }).success).toBe(true);
    expect(p.safeParse({ cwd: "", prompt: "hi" }).success).toBe(false);
    expect(p.safeParse({ cwd: "/w", prompt: "hi", permissionMode: "yolo" }).success).toBe(false);
  });

  test("question.answer carries answers by question text", () => {
    const p = RpcContract["question.answer"].params;
    const ok = {
      sessionId: "s",
      agentId: "main",
      requestId: "r",
      answers: { "Which DB?": "SQLite" },
    };
    expect(p.safeParse(ok).success).toBe(true);
    expect(p.safeParse({ ...ok, answers: { q: 1 } }).success).toBe(false);
  });
});
