import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { EventOf, GravitaEvent } from "@gravita/protocol";
import { GravitaEvent as GravitaEventSchema } from "@gravita/protocol";
import { parseTaskNotification, readSession } from "../src";

const FIXTURE = join(
  import.meta.dir,
  "../../../fixtures/claude/2.1.296/nested-background/11111111-1111-4111-8111-111111111111.jsonl",
);
const SID = "11111111-1111-4111-8111-111111111111";

const byType = <T extends GravitaEvent["type"]>(events: GravitaEvent[], type: T) =>
  events.filter((e): e is EventOf<T> => e.type === type);

describe("readSession", () => {
  test("every event matches the protocol schema", async () => {
    const events = await readSession(FIXTURE, { projectId: "p1" });
    for (const e of events) expect(() => GravitaEventSchema.parse(e)).not.toThrow();
    expect(events.length).toBeGreaterThan(10);
  });

  test("resolves parents for foreground, background and nested subagents", async () => {
    const events = await readSession(FIXTURE, { projectId: "p1" });
    const spawned = Object.fromEntries(
      byType(events, "agent.spawned").map((e) => [e.agentId, e.data]),
    );
    expect(spawned.a0000000000000001).toMatchObject({
      parentAgentId: "main",
      agentType: "Explore",
      background: false,
      depth: 1,
    });
    expect(spawned.a0000000000000002).toMatchObject({
      parentAgentId: "main",
      agentType: "Plan",
      background: true,
      depth: 1,
    });
    expect(spawned.a0000000000000003).toMatchObject({
      parentAgentId: "a0000000000000002",
      agentType: "Explore",
      depth: 2,
    });
  });

  test("completions come from tool results and task notifications", async () => {
    const events = await readSession(FIXTURE, { projectId: "p1" });
    const done = new Map(byType(events, "agent.completed").map((e) => [e.agentId, e.data]));
    expect(done.get("a0000000000000001")).toMatchObject({ status: "completed", totalTokens: 500 });
    expect(done.get("a0000000000000002")).toMatchObject({
      status: "completed",
      summary: "Migration plan ready",
    });
    expect(done.get("a0000000000000003")).toMatchObject({ status: "completed" });
  });

  test("keys are unique per fact and stable across reads", async () => {
    const a = await readSession(FIXTURE, { projectId: "p1" });
    const b = await readSession(FIXTURE, { projectId: "p1" });
    expect(a.map((e) => e.key)).toEqual(b.map((e) => e.key));
    const nonUsage = a.filter((e) => e.type !== "usage.reported").map((e) => e.key);
    // A completion can be reported by two sources (tool result + notification); same key.
    const dupes = nonUsage.filter((k, i) => nonUsage.indexOf(k) !== i);
    expect(dupes.every((k) => k.startsWith("agent:"))).toBe(true);
  });

  test("session metadata, title, file changes and turn end", async () => {
    const events = await readSession(FIXTURE, { projectId: "p1" });
    const started = byType(events, "session.started");
    expect(started).toHaveLength(1);
    expect(started[0]!.data).toMatchObject({
      kind: "external",
      cwd: "/work/demo",
      gitBranch: "main",
      cliVersion: "2.1.296",
    });
    expect(byType(events, "session.titled")[0]!.data.title).toBe("Auth flow mapping");
    const edit = byType(events, "tool.completed").find((e) => e.data.toolUseId === "toolu_E1");
    expect(edit!.data.fileChanges).toEqual([
      { path: "/work/demo/src/auth/login.ts", added: 2, removed: 1 },
    ]);
    expect(edit!.agentId).toBe("a0000000000000003");
    expect(byType(events, "turn.completed").map((e) => e.sessionId)).toEqual([SID]);
  });

  test("never surfaces credential-bearing records", async () => {
    const events = await readSession(FIXTURE, { projectId: "p1" });
    expect(JSON.stringify(events)).not.toContain("must-never-be-read");
  });
});

describe("parseTaskNotification", () => {
  test("extracts id, status and summary", () => {
    expect(
      parseTaskNotification(
        "<task-notification><task-id>a1</task-id><status>failed</status></task-notification>",
      ),
    ).toEqual({ taskId: "a1", status: "failed" });
    expect(parseTaskNotification("plain text")).toBeNull();
  });
});
