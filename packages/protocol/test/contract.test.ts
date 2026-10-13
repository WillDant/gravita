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
