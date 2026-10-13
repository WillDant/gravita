import { describe, expect, test } from "bun:test";
import { applyAll, emptyState } from "@gravita/core";
import { type GravitaEvent, GravitaEvent as GravitaEventSchema } from "@gravita/protocol";
import { CODEX_MODEL, CODEX_START_MS, codexSession, DEMO_PROJECTS, scenarioEvents } from "../src";

const NOW = () => Date.parse("2026-10-12T10:00:00.000Z");
const stamped = (seed: number, cycle = 0): GravitaEvent[] =>
  codexSession(seed, cycle, CODEX_START_MS).events.map((t) => ({
    ...t.event,
    ts: new Date(NOW() + t.at).toISOString(),
  }));

describe("Codex demo story", () => {
  const events = stamped(1);
  const sid = events.find((e) => e.type === "session.started")!.sessionId!;

  test("every event matches the protocol schema, as Codex sends it", () => {
    for (const e of events) expect(() => GravitaEventSchema.parse(e)).not.toThrow();
    expect(events.every((e) => e.provider === "codex")).toBe(true);
    expect(sid).toMatch(/^codex:[0-9a-f-]{36}$/);
    const keys = events.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("an explorer subagent runs its own commands and finishes", () => {
    const spawned = events.filter((e) => e.type === "agent.spawned");
    expect(spawned).toHaveLength(1);
    const explorer = spawned[0]!;
    expect(explorer.type === "agent.spawned" && explorer.data.agentType).toBe("explorer");
    expect(explorer.agentId).toMatch(/^codex:[0-9a-f-]{36}$/);
    const own = events.filter((e) => e.agentId === explorer.agentId && e.type === "tool.started");
    expect(own.length).toBeGreaterThanOrEqual(2);

    const session = applyAll(emptyState(), events).sessions[sid]!;
    expect(session.provider).toBe("codex");
    expect(session.agents[explorer.agentId!]!.lifecycle).toBe("done");
    expect(session.agents.main!.lifecycle).toBe("idle");
    expect(session.ended).toBe(true);
  });

  test("runs commands and applies a patch in Codex's tool kinds", () => {
    const tools = events.flatMap((e) => (e.type === "tool.started" ? [e.data] : []));
    const bash = tools.filter((t) => t.name === "exec_command");
    expect(bash.length).toBeGreaterThanOrEqual(3);
    expect(bash.every((t) => t.kind === "bash" && Boolean(t.target.cmd))).toBe(true);
    const patch = tools.find((t) => t.name === "apply_patch")!;
    expect(patch.kind).toBe("edit");
    expect(patch.target.path).toBe(`${DEMO_PROJECTS.build.root}/.github/workflows/ci.yml`);
    expect(tools.find((t) => t.name === "spawn_agent")?.kind).toBe("agent");

    const done = events.find(
      (e) => e.type === "tool.completed" && e.data.toolUseId === patch.toolUseId,
    );
    const changes = done?.type === "tool.completed" ? done.data.fileChanges : undefined;
    expect(changes).toHaveLength(2);
    expect(changes!.every((c) => (c.added ?? 0) > 0 && (c.removed ?? 0) > 0)).toBe(true);
  });

  test("reports usage on the Codex model and ends its turn without a cost", () => {
    const usage = events.filter((e) => e.type === "usage.reported");
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((e) => e.type === "usage.reported" && e.data.model === CODEX_MODEL)).toBe(
      true,
    );
    const turn = events.find((e) => e.type === "turn.completed");
    expect(turn?.type === "turn.completed" && turn.data.costUsd).toBeUndefined();
  });

  test("is deterministic for a seed and plays inside the demo", () => {
    expect(stamped(4)).toEqual(stamped(4));
    expect(stamped(5)[0]!.sessionId).not.toBe(stamped(4)[0]!.sessionId);
    const demo = scenarioEvents({ seed: 1, now: NOW }, CODEX_START_MS + 60_000);
    expect(demo.some((e) => e.sessionId === sid && e.type === "session.started")).toBe(true);
  });
});
