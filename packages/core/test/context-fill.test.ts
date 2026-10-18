import { describe, expect, test } from "bun:test";
import type { GravitaEvent } from "@gravita/protocol";
import { applyAll, emptyState } from "../src";

// How full a session's context window is: read from its main agent's latest reply.

const started: GravitaEvent = {
  key: "start",
  ts: "2026-10-18T10:00:00.000Z",
  source: "fake",
  provider: "claude",
  projectId: "p1",
  sessionId: "s1",
  type: "session.started",
  data: { kind: "external", cwd: "/work/p1" },
} as GravitaEvent;

function usage(
  ts: string,
  messageId: string,
  t: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
  o: { agentId?: string; model?: string; contextWindow?: number } = {},
): GravitaEvent {
  return {
    key: `usage:${messageId}:${t.output}`,
    ts,
    source: "fake",
    provider: "claude",
    projectId: "p1",
    sessionId: "s1",
    ...(o.agentId ? { agentId: o.agentId } : {}),
    type: "usage.reported",
    data: {
      messageId,
      input: t.input,
      output: t.output,
      cacheRead: t.cacheRead ?? 0,
      cacheWrite: t.cacheWrite ?? 0,
      ...(o.model ? { model: o.model } : {}),
      ...(o.contextWindow ? { contextWindow: o.contextWindow } : {}),
    },
  } as GravitaEvent;
}

const ctx = (events: GravitaEvent[]) => applyAll(emptyState(), events).sessions.s1?.context;

describe("session context fill", () => {
  test("is absent before the first reply", () => {
    expect(ctx([started])).toBeUndefined();
  });

  test("counts what the latest main-agent reply read and wrote", () => {
    expect(
      ctx([
        started,
        usage("2026-10-18T10:01:00.000Z", "m1", { input: 10, output: 5, cacheRead: 1000 }),
        usage(
          "2026-10-18T10:02:00.000Z",
          "m2",
          { input: 20, output: 30, cacheRead: 1500, cacheWrite: 50 },
          { model: "claude-opus-5-5" },
        ),
      ]),
    ).toEqual({ tokens: 1600, model: "claude-opus-5-5", ts: "2026-10-18T10:02:00.000Z" });
  });

  test("an older reply arriving late doesn't win", () => {
    expect(
      ctx([
        started,
        usage("2026-10-18T10:02:00.000Z", "m2", { input: 0, output: 0, cacheRead: 900 }),
        usage("2026-10-18T10:01:00.000Z", "m1", { input: 0, output: 0, cacheRead: 100 }),
      ])?.tokens,
    ).toBe(900);
  });

  test("ignores subagents, which have their own windows", () => {
    expect(
      ctx([
        started,
        usage("2026-10-18T10:01:00.000Z", "m1", { input: 0, output: 0, cacheRead: 700 }),
        usage(
          "2026-10-18T10:02:00.000Z",
          "sub1",
          { input: 0, output: 0, cacheRead: 99 },
          { agentId: "a1" },
        ),
      ])?.tokens,
    ).toBe(700);
  });

  test("keeps the window the provider reported", () => {
    expect(
      ctx([
        started,
        usage(
          "2026-10-18T10:01:00.000Z",
          "m1",
          { input: 5, output: 5 },
          { contextWindow: 272_000 },
        ),
      ])?.window,
    ).toBe(272_000);
  });

  test("takes the window the turn reported, and keeps it over later replies", () => {
    const turn = {
      key: "turn:r1",
      ts: "2026-10-18T10:01:30.000Z",
      source: "fake",
      provider: "claude",
      projectId: "p1",
      sessionId: "s1",
      type: "turn.completed",
      data: { contextWindow: 1_000_000 },
    } as GravitaEvent;
    expect(
      ctx([
        started,
        usage("2026-10-18T10:01:00.000Z", "m1", { input: 0, output: 0, cacheRead: 300_000 }),
        turn,
        usage("2026-10-18T10:02:00.000Z", "m2", { input: 0, output: 0, cacheRead: 310_000 }),
      ]),
    ).toMatchObject({ tokens: 310_000, window: 1_000_000 });
  });
});
