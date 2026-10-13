import { describe, expect, test } from "bun:test";
import { applyAll, buildLineMap, emptyState, type GravitaState } from "@gravita/core";
import { type GravitaEvent, GravitaEvent as GravitaEventSchema } from "@gravita/protocol";
import { DEMO_PROJECTS, SWARM_SIZE, scenarioEvents, startScenario } from "../src";

const NOW = () => Date.parse("2026-10-12T10:00:00.000Z");
/** Three OAuth sessions and several landing-site turns. */
const SPAN = 250_000;

const project = (state: GravitaState, name: string) =>
  Object.values(state.projects).find((p) => p.name === name)!;

describe("demo scenario", () => {
  test("every event matches the protocol schema and keys are unique", () => {
    const events = scenarioEvents({ seed: 1, now: NOW }, SPAN);
    expect(events.length).toBeGreaterThan(500);
    for (const e of events) expect(() => GravitaEventSchema.parse(e)).not.toThrow();
    const keys = events.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("covers every tool kind, permissions, usage and every project", () => {
    const events = scenarioEvents({ seed: 1, now: NOW }, SPAN);
    const kinds = new Set(events.flatMap((e) => (e.type === "tool.started" ? [e.data.kind] : [])));
    for (const k of ["read", "search", "edit", "write", "bash", "web", "agent", "mcp", "todo"]) {
      expect(kinds.has(k as never)).toBe(true);
    }
    const names = new Set(events.flatMap((e) => (e.type === "tool.started" ? [e.data.name] : [])));
    for (const n of [
      "Read",
      "Grep",
      "Glob",
      "Edit",
      "Write",
      "Bash",
      "WebFetch",
      "Agent",
      "mcp__github__search_issues",
    ]) {
      expect(names.has(n)).toBe(true);
    }
    const asks = events.flatMap((e) =>
      e.type === "permission.requested" ? [e.data.inputPreview] : [],
    );
    expect(asks).toContain("pnpm add jose");
    expect(events.some((e) => e.type === "usage.reported")).toBe(true);
    expect(new Set(events.map((e) => e.projectId))).toEqual(
      new Set([
        DEMO_PROJECTS.gravita.id,
        DEMO_PROJECTS.landing.id,
        DEMO_PROJECTS.payments.id,
        DEMO_PROJECTS.todo.id,
        DEMO_PROJECTS.build.id,
      ]),
    );
  });

  test("is deterministic for a seed and differs across seeds", () => {
    const a = scenarioEvents({ seed: 7, now: NOW }, SPAN);
    const b = scenarioEvents({ seed: 7, now: NOW }, SPAN);
    expect(a).toEqual(b);
    const c = scenarioEvents({ seed: 8, now: NOW }, SPAN);
    expect(c.map((e) => e.key)).not.toEqual(a.map((e) => e.key));
  });

  test("timestamps never go backwards and speed compresses them", () => {
    const events = scenarioEvents({ seed: 1, now: NOW }, SPAN);
    for (let i = 1; i < events.length; i++) expect(events[i]!.ts >= events[i - 1]!.ts).toBe(true);
    const fast = scenarioEvents({ seed: 1, now: NOW, speed: 2 }, SPAN);
    expect(fast.map((e) => e.key)).toEqual(events.map((e) => e.key));
    const span = (es: GravitaEvent[]) => Date.parse(es.at(-1)!.ts) - NOW();
    expect(span(fast)).toBeCloseTo(span(events) / 2, -1);
  });

  test("tells the story through the core reducer", () => {
    const events = scenarioEvents({ seed: 1, now: NOW }, SPAN);
    const oauth = (e: GravitaEvent) => e.projectId === DEMO_PROJECTS.gravita.id;
    const asked = events.findIndex((e) => e.type === "permission.requested" && oauth(e));
    const mid = applyAll(emptyState(), events.slice(0, asked + 1));
    const live = mid.sessions[events[asked]!.sessionId!]!;
    expect(live.title).toBe("Add OAuth login");
    expect(live.agents[events[asked]!.agentId!]!.lifecycle).toBe("waiting_user");

    const firstEnd = events.findIndex((e) => e.type === "session.ended" && oauth(e));
    const state = applyAll(emptyState(), events.slice(0, firstEnd + 1));
    const session = state.sessions[events[firstEnd]!.sessionId!]!;
    const subs = Object.values(session.agents).filter((a) => a.id !== "main");
    expect(subs.map((a) => a.agentType).sort()).toEqual(["Explore", "Explore", "Explore", "Plan"]);
    expect(subs.every((a) => a.lifecycle === "done")).toBe(true);
    const plan = subs.find((a) => a.agentType === "Plan")!;
    const nested = subs.find((a) => a.parentId === plan.id)!;
    expect(nested.depth).toBe(2);
    expect(session.agents.main!.children).toHaveLength(3);
    expect(session.agents.main!.lifecycle).toBe("idle");
    expect(session.agents.main!.tokens.output).toBeGreaterThan(0);
    expect(session.agents.main!.filesTouched.length).toBeGreaterThanOrEqual(4);
    expect(session.ended).toBe(true);

    expect(project(state, "gravita-demo").sessionIds).toHaveLength(1);
    const landing = project(state, "landing-site");
    expect(landing.sessionIds).toHaveLength(1);
    expect(Object.keys(state.sessions[landing.sessionIds[0]!]!.agents)).toEqual(["main"]);

    const later = applyAll(emptyState(), events);
    expect(project(later, "gravita-demo").sessionIds.length).toBeGreaterThanOrEqual(3);
  });

  test("startScenario plays the same events in order and stops", async () => {
    const got: GravitaEvent[] = [];
    const stop = startScenario({ seed: 3, now: NOW, speed: 2_000 }, (e) => got.push(e));
    await Bun.sleep(150);
    stop();
    const count = got.length;
    await Bun.sleep(50);
    expect(got.length).toBe(count);
    expect(count).toBeGreaterThan(50);
    expect(got).toEqual(
      scenarioEvents({ seed: 3, now: NOW, speed: 2_000 }, SPAN * 4).slice(0, count),
    );
  });
});

describe("swarm story", () => {
  const events = scenarioEvents({ seed: 1, now: NOW }, SPAN);
  const swarm = events.filter((e) => e.projectId === DEMO_PROJECTS.payments.id);
  const sid = swarm.find((e) => e.type === "session.started")!.sessionId!;
  const own = swarm.filter((e) => e.sessionId === sid);
  const end = own.findIndex((e) => e.type === "session.ended");

  test("main launches nine subagents in one message; one of them nests an Explore", () => {
    const state = applyAll(emptyState(), own.slice(0, end + 1));
    const s = state.sessions[sid]!;
    expect(s.title).toBe("Audit before release");
    const main = s.agents.main!;
    expect(main.children).toHaveLength(SWARM_SIZE);
    const subs = Object.values(s.agents).filter((a) => a.id !== "main");
    expect(subs).toHaveLength(SWARM_SIZE + 1);
    const types = new Set(main.children.map((id) => s.agents[id]!.agentType));
    expect(types).toEqual(new Set(["Explore", "Plan", "general-purpose", "code-reviewer"]));
    const nested = subs.filter((a) => a.parentId !== "main");
    expect(nested).toHaveLength(1);
    expect(nested[0]!.agentType).toBe("Explore");
    expect(nested[0]!.depth).toBe(2);
    expect(main.children).toContain(nested[0]!.parentId!);

    // One fails, the rest finish; then main writes the report and rests.
    expect(subs.filter((a) => a.lifecycle === "failed")).toHaveLength(1);
    expect(subs.filter((a) => a.lifecycle === "done")).toHaveLength(SWARM_SIZE);
    expect(main.lifecycle).toBe("idle");
    expect(main.filesTouched.some((f) => f.endsWith("audit-2.4.md"))).toBe(true);
  });

  test("two subagents wait on a permission at the same time", () => {
    const asks = own.filter((e) => e.type === "permission.requested");
    expect(asks).toHaveLength(2);
    const second = own.indexOf(asks[1]!);
    const mid = applyAll(emptyState(), own.slice(0, second + 1)).sessions[sid]!;
    const waiting = Object.values(mid.agents).filter((a) => a.lifecycle === "waiting_user");
    expect(waiting).toHaveLength(2);
    expect(waiting.every((a) => a.parentId === "main")).toBe(true);
  });

  test("the fan-out lands on consecutive columns and merges back one by one", () => {
    const map = buildLineMap(own.slice(0, end));
    const children = map.lines.filter((l) => l.parentId === "main");
    expect(children).toHaveLength(SWARM_SIZE);
    const cols = children.map((l) => l.startCol).sort((a, b) => a - b);
    expect(cols.at(-1)! - cols[0]!).toBe(SWARM_SIZE - 1);
    expect(map.lines.every((l) => l.agentId === "main" || l.ended)).toBe(true);
    const ends = new Set(children.map((l) => l.endCol));
    expect(ends.size).toBe(SWARM_SIZE);
  });

  test("replays as a loop, and every event is valid", () => {
    const sessions = new Set(swarm.flatMap((e) => (e.sessionId ? [e.sessionId] : [])));
    expect(sessions.size).toBeGreaterThanOrEqual(3);
    for (const e of swarm) expect(() => GravitaEventSchema.parse(e)).not.toThrow();
  });
});
