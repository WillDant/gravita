import { describe, expect, test } from "bun:test";
import type { Gaze, Mood } from "@gravita/core";
import {
  agentColor,
  DARK_THEME,
  LIGHT_THEME,
  layoutOrbit,
  MIN_FRAME,
  paintOrb,
  paintOrbit,
} from "../src";
import { agent, fakePath, orbit, RecordingCtx } from "./orbit-fakes";

const MOODS: Mood[] = [
  "idle",
  "thinking",
  "focused",
  "busy",
  "delegating",
  "waiting",
  "blocked",
  "error",
  "done",
  "stopped",
  "away",
];
const GAZES: Gaze[] = [
  { kind: "wander" },
  { kind: "tool", toolKind: "bash" },
  { kind: "child", agentId: "c" },
  { kind: "viewer" },
  { kind: "up" },
  { kind: "closed" },
];

const orb = (mood: Mood, gaze: Gaze, over = {}) => ({
  x: 50,
  y: 50,
  size: 36,
  color: agentColor("main"),
  persona: { mood, gaze, glyph: "spark" },
  t: 1234,
  seed: "main",
  makePath: fakePath,
  ...over,
});

describe("paintOrb", () => {
  test("every mood and gaze paints, ink-ringed, in both themes", () => {
    for (const theme of [LIGHT_THEME, DARK_THEME]) {
      for (const mood of MOODS) {
        for (const gaze of GAZES) {
          const ctx = new RecordingCtx();
          paintOrb(ctx, orb(mood, gaze), theme);
          // Body fill in the agent's colour, ink ring around it, ink-ringed glyph badge.
          expect(ctx.count("fill", agentColor("main").fill)).toBe(1);
          expect(ctx.count("stroke", theme.ink)).toBeGreaterThanOrEqual(2);
          expect(ctx.count("strokePath", theme.ink)).toBe(1);
          // Orange only when the orb waits on you.
          expect(ctx.count("stroke", theme.waiting) > 0).toBe(mood === "waiting");
        }
      }
    }
  });

  test("open eyes draw whites and pupils; closed eyes are ink strokes", () => {
    const open = new RecordingCtx();
    paintOrb(open, orb("focused", { kind: "viewer" }), LIGHT_THEME);
    expect(open.count("ellipse")).toBe(3); // highlight + two eyes
    expect(open.count("fill", "#121417")).toBe(2);

    const closed = new RecordingCtx();
    paintOrb(closed, orb("done", { kind: "closed" }), LIGHT_THEME);
    expect(closed.count("ellipse")).toBe(1);
    expect(closed.count("fill", "#121417")).toBe(0);
  });

  test("the glyph badge can be hidden, and a pop starts transparent", () => {
    const ctx = new RecordingCtx();
    paintOrb(ctx, orb("busy", { kind: "up" }, { glyph: false, spawnAge: 0 }), LIGHT_THEME);
    expect(ctx.count("strokePath")).toBe(0);
    expect(ctx.ops.find((o) => o.op === "fill")?.alpha).toBe(0);
  });

  test("stopped orbs fade their body like the SVG orb", () => {
    const ctx = new RecordingCtx();
    paintOrb(ctx, orb("stopped", { kind: "closed" }), LIGHT_THEME);
    const body = ctx.ops.find((o) => o.op === "fill" && o.style === agentColor("main").fill);
    expect(body?.alpha).toBeCloseTo(0.45);
  });
});

describe("paintOrbit", () => {
  const input = orbit([
    agent("main", { mood: "waiting", lifecycle: "waiting_user", glyph: "hand" }),
    ...Array.from({ length: 9 }, (_, i) => agent(`k${i}`, { spawnedAt: i })),
  ]);

  test("draws rings, a neutral sun with the initial, orbs and the swarm label", () => {
    const l = layoutOrbit(input, MIN_FRAME, 0);
    const ctx = new RecordingCtx();
    paintOrbit(ctx, l, 0, LIGHT_THEME, { makePath: fakePath, selectedId: "k8", focusId: "k7" });

    expect(ctx.count("stroke", LIGHT_THEME.ring)).toBe(l.rings.length);
    expect(ctx.texts()).toEqual(["G", "×4"]);
    // The sun is ground with an ink ring; no agent hue on it.
    const sunFill = ctx.ops.findIndex((o) => o.op === "fill");
    expect(ctx.ops[sunFill]?.style).toBe(LIGHT_THEME.ground);
    // Main plus five moons are full orbs.
    expect(ctx.count("fill", agentColor("main").fill)).toBe(1);
    expect(ctx.count("fill", agentColor("Explore").fill)).toBe(5 + 3);
    // Selection in ink, then keyboard focus in focus blue, last.
    const strokes = ctx.ops.filter((o) => o.op === "stroke");
    expect(strokes.at(-2)?.style).toBe(LIGHT_THEME.ink);
    expect(strokes.at(-1)?.style).toBe(LIGHT_THEME.focus);
  });

  test("a failed orb carries an error ring, whatever the motion budget says", () => {
    const failed = orbit([
      agent("main"),
      agent("bad", { mood: "error", lifecycle: "failed", glyph: "alert" }),
    ]);
    for (const primary of [undefined, new Set<string>()]) {
      const ctx = new RecordingCtx();
      paintOrbit(ctx, layoutOrbit(failed, MIN_FRAME, 0), 0, LIGHT_THEME, {
        makePath: fakePath,
        ...(primary ? { primary } : {}),
      });
      expect(ctx.count("stroke", LIGHT_THEME.error)).toBe(1);
    }
    const ctx = new RecordingCtx();
    paintOrbit(ctx, layoutOrbit(orbit([agent("main")]), MIN_FRAME, 0), 0, LIGHT_THEME);
    expect(ctx.count("stroke", LIGHT_THEME.error)).toBe(0);
  });

  test("ambient allowance keeps a waiting orb still but keeps its orange halo", () => {
    const l = layoutOrbit(input, MIN_FRAME, 0);
    const ctx = new RecordingCtx();
    paintOrbit(ctx, l, 300, DARK_THEME, { primary: new Set(), makePath: fakePath });
    expect(ctx.count("stroke", DARK_THEME.waiting)).toBe(1);
  });
});
