import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Mood, Persona } from "@gravita/core";
import {
  allocateMotion,
  bezier,
  bodyMotion,
  EASE,
  GLYPHS,
  motionCap,
  orbPose,
  popIn,
} from "../src";

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
const persona = (mood: Mood, gaze: Persona["gaze"] = { kind: "wander" }) => ({ mood, gaze });

describe("bezier", () => {
  test("matches the endpoints and overshoots for the pop ease", () => {
    const pop = bezier(EASE.pop);
    expect(pop(0)).toBe(0);
    expect(pop(1)).toBe(1);
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => pop(i / 50)));
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.2);
    expect(bezier([0, 0, 1, 1])(0.3)).toBeCloseTo(0.3, 3);
  });
});

describe("orbPose", () => {
  test("is deterministic in t and every mood has a pose", () => {
    for (const mood of MOODS) {
      for (const t of [0, 333, 1300, 98_765]) {
        const a = orbPose(persona(mood), t, { seed: "a1" });
        expect(orbPose(persona(mood), t, { seed: "a1" })).toEqual(a);
        for (const v of [a.sx, a.sy, a.dx, a.dy, a.rotate, a.blink, a.opacity]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    }
  });

  test("breathing stays within 1..1.045 and seeds desynchronise orbs", () => {
    const scales = Array.from({ length: 100 }, (_, i) => orbPose(persona("idle"), i * 50).sx);
    expect(Math.min(...scales)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.045 + 1e-9);
    expect(orbPose(persona("idle"), 1000, { seed: "a" }).sx).not.toBe(
      orbPose(persona("idle"), 1000, { seed: "b" }).sx,
    );
  });

  test("waiting bounces from the bottom with a pulsing halo; error wobbles ±6°", () => {
    const lifts = Array.from({ length: 130 }, (_, i) => orbPose(persona("waiting"), i * 10).dy);
    expect(Math.min(...lifts)).toBeCloseTo(-4, 0);
    const w = orbPose(persona("waiting"), 0);
    expect(w.pivot).toBe("bottom");
    expect(w.halo).not.toBeNull();
    const angles = Array.from({ length: 90 }, (_, i) => orbPose(persona("error"), i * 10).rotate);
    expect(Math.max(...angles.map(Math.abs))).toBeCloseTo((6 * Math.PI) / 180, 2);
  });

  test("an ambient allowance turns primary motion into breathing, keeping the halo", () => {
    expect(bodyMotion("waiting", "ambient")).toBe("breathe");
    expect(bodyMotion("error", "ambient")).toBe("breathe");
    expect(bodyMotion("busy", "ambient")).toBe("bob");
    const w = orbPose(persona("waiting"), 260, { motion: "ambient" });
    expect(w.dy).toBe(0);
    expect(w.halo).not.toBeNull();
  });

  test("reduced motion is a static pose that still tells the state", () => {
    for (const mood of MOODS) {
      const p = orbPose(persona(mood), 777, { reducedMotion: true });
      expect([p.sx, p.sy, p.dx, p.dy, p.rotate, p.blink]).toEqual([1, 1, 0, 0, 0, 1]);
      expect(p.halo !== null).toBe(mood === "waiting");
    }
    expect(popIn(10, true)).toEqual({ scale: 1, opacity: 1 });
  });

  test("eyes: closed, the done smile, and gaze moving the pupils", () => {
    expect(orbPose(persona("done", { kind: "closed" }), 0).eyes).toBe("smile");
    expect(orbPose(persona("idle", { kind: "closed" }), 0).eyes).toBe("closed");
    const up = orbPose(persona("thinking", { kind: "up" }), 0, { reducedMotion: true });
    expect(up.pupil.dy).toBeLessThan(0);
    const you = orbPose(persona("waiting", { kind: "viewer" }), 0, { reducedMotion: true });
    expect(you.pupil.r).toBeGreaterThan(up.pupil.r);
  });

  test("the spawn pop grows from 0.2 with a small overshoot and settles at 1", () => {
    expect(popIn(0).scale).toBeCloseTo(0.2);
    expect(Math.max(...Array.from({ length: 48 }, (_, i) => popIn(i * 10).scale))).toBeGreaterThan(
      1,
    );
    expect(popIn(480)).toEqual({ scale: 1, opacity: 1 });
  });
});

describe("allocateMotion (the 1/3 rule)", () => {
  const now = 10_000;
  test("caps primary motion at a third of the visible orbs, at least one", () => {
    expect(motionCap(1)).toBe(1);
    expect(motionCap(5)).toBe(1);
    expect(motionCap(9)).toBe(3);
    const crowd = Array.from({ length: 9 }, (_, i) => ({ id: `w${i}`, mood: "waiting" as Mood }));
    expect(allocateMotion(crowd, now).size).toBe(3);
  });

  test("waiting beats error beats a fresh spawn; calm orbs never get motion", () => {
    const set = allocateMotion(
      [
        { id: "calm1", mood: "busy" },
        { id: "calm2", mood: "idle" },
        { id: "calm3", mood: "focused" },
        { id: "spawn", mood: "busy", spawnedAt: now - 100 },
        { id: "err", mood: "error" },
        { id: "wait", mood: "waiting" },
      ],
      now,
    );
    expect([...set]).toEqual(["wait", "err"]);
    expect(allocateMotion([{ id: "old", mood: "busy", spawnedAt: now - 5_000 }], now).size).toBe(0);
  });

  test("ties go to the freshest change, then by id, stably", () => {
    const c = [
      { id: "b", mood: "waiting" as Mood, changedAt: 5 },
      { id: "a", mood: "waiting" as Mood, changedAt: 5 },
      { id: "c", mood: "waiting" as Mood, changedAt: 9 },
      ...Array.from({ length: 3 }, (_, i) => ({ id: `x${i}`, mood: "idle" as Mood })),
    ];
    expect([...allocateMotion(c, now)]).toEqual(["c", "a"]);
    expect([...allocateMotion([...c].reverse(), now)]).toEqual(["c", "a"]);
  });
});

describe("glyphs", () => {
  test("every glyph toPersona can emit has a path", () => {
    const src = readFileSync(join(import.meta.dir, "../../core/src/status.ts"), "utf8");
    const ids = new Set<string>();
    for (const m of src.matchAll(/glyph: (?:[^"\n]*\? )?"(\w+)"(?: : "(\w+)")?/g)) {
      ids.add(m[1]!);
      if (m[2]) ids.add(m[2]);
    }
    const table = src.match(/const glyphs: Record<string, string> = \{([\s\S]*?)\}/)?.[1] ?? "";
    for (const m of table.matchAll(/:\s*"(\w+)"/g)) ids.add(m[1]!);
    expect(ids.size).toBeGreaterThan(15);
    for (const id of ids) expect(GLYPHS).toHaveProperty(id);
  });
});
