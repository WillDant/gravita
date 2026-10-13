import { describe, expect, test } from "bun:test";
import { applyAll, emptyState, type GravitaState } from "@gravita/core";
import { type GravitaEvent, GravitaEvent as GravitaEventSchema } from "@gravita/protocol";
import { DEMO_PROJECTS, scenarioEvents, startScenario } from "../src";

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

  test("covers every tool kind, permissions, usage and both projects", () => {
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
    const perm = events.find((e) => e.type === "permission.requested");
    expect(perm?.type === "permission.requested" && perm.data.inputPreview).toBe("pnpm add jose");
    expect(events.some((e) => e.type === "usage.reported")).toBe(true);
    expect(new Set(events.map((e) => e.projectId))).toEqual(
      new Set([DEMO_PROJECTS.gravita.id, DEMO_PROJECTS.landing.id]),
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
    const asked = events.findIndex((e) => e.type === "permission.requested");
    const mid = applyAll(emptyState(), events.slice(0, asked + 1));
    const live = mid.sessions[events[asked]!.sessionId!]!;
    expect(live.title).toBe("Add OAuth login");
    expect(live.agents[events[asked]!.agentId!]!.lifecycle).toBe("waiting_user");

    const firstEnd = events.findIndex((e) => e.type === "session.ended");
    const state = applyAll(emptyState(), events.slice(0, firstEnd + 1));
    const oauth = state.sessions[events[firstEnd]!.sessionId!]!;
    const subs = Object.values(oauth.agents).filter((a) => a.id !== "main");
    expect(subs.map((a) => a.agentType).sort()).toEqual(["Explore", "Explore", "Explore", "Plan"]);
    expect(subs.every((a) => a.lifecycle === "done")).toBe(true);
    const plan = subs.find((a) => a.agentType === "Plan")!;
    const nested = subs.find((a) => a.parentId === plan.id)!;
    expect(nested.depth).toBe(2);
    expect(oauth.agents.main!.children).toHaveLength(3);
    expect(oauth.agents.main!.lifecycle).toBe("idle");
    expect(oauth.agents.main!.tokens.output).toBeGreaterThan(0);
    expect(oauth.agents.main!.filesTouched.length).toBeGreaterThanOrEqual(4);
    expect(oauth.ended).toBe(true);

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
