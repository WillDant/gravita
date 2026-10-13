import { describe, expect, test } from "bun:test";
import { layoutOrbit, MIN_FRAME, type OrbitBody, type OrbitLayout, SUN_ID, swarmId } from "../src";
import { agent, orbit } from "./orbit-fakes";

const byId = (l: OrbitLayout) => new Map(l.bodies.map((b) => [b.id, b]));
const body = (l: OrbitLayout, id: string): OrbitBody => {
  const b = byId(l).get(id);
  if (!b) throw new Error(`no body ${id}`);
  return b;
};

function expectFitsWithoutOverlap(l: OrbitLayout) {
  for (const b of l.bodies) {
    expect(b.x - b.r).toBeGreaterThanOrEqual(0);
    expect(b.y - b.r).toBeGreaterThanOrEqual(0);
    expect(b.x + b.r).toBeLessThanOrEqual(l.width);
    expect(b.y + b.r).toBeLessThanOrEqual(l.height);
  }
  for (let i = 0; i < l.bodies.length; i++) {
    for (let j = i + 1; j < l.bodies.length; j++) {
      const a = l.bodies[i]!;
      const b = l.bodies[j]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r);
    }
  }
}

const crowd = (n: number, parent = "main", over = {}) =>
  Array.from({ length: n }, (_, i) =>
    agent(`${parent}-k${i}`, { parentId: parent, spawnedAt: 1000 + i, ...over }),
  );

describe("layoutOrbit", () => {
  test("the project is the sun, main a planet, subagents its moons", () => {
    const l = layoutOrbit(orbit([agent("main"), agent("a1"), agent("a2")]), MIN_FRAME, 0);
    expect(l.bodies.map((b) => [b.id, b.kind])).toEqual([
      [SUN_ID, "sun"],
      ["main", "planet"],
      ["a1", "moon"],
      ["a2", "moon"],
    ]);
    const sun = body(l, SUN_ID);
    expect(sun.label).toBe("G");
    const main = body(l, "main");
    expect(main.around).toBe(SUN_ID);
    expect(body(l, "a1").around).toBe("main");
    expect(body(l, "a1").r).toBeLessThan(main.r);
    expect(l.rings.map((r) => r.around)).toEqual([SUN_ID, "main"]);
  });

  test("a lone planet sits pinned to the sun's right and its system fills the pane", () => {
    const input = orbit([agent("main"), ...crowd(5)]);
    for (const frame of [MIN_FRAME, { width: 720, height: 540 }, { width: 1200, height: 500 }]) {
      const a = layoutOrbit(input, frame, 0);
      const b = layoutOrbit(input, frame, 45_000);
      const sun = body(a, SUN_ID);
      const main = body(a, "main");
      // Pinned: same place at any t, level with the sun, to its right; moons still drift.
      expect(body(b, "main")).toMatchObject({ x: main.x, y: main.y, angle: 0 });
      expect(main.y).toBe(sun.y);
      expect(sun.x).toBeLessThanOrEqual(frame.width / 3 + 1e-9);
      expect(body(b, "main-k0").angle).not.toBe(body(a, "main-k0").angle);
      // The planet's system takes most of the pane's smaller side.
      const ring = a.rings.find((r) => r.around === "main")!;
      const moonR = body(a, "main-k0").r;
      expect(2 * (ring.r + moonR)).toBeGreaterThan(
        0.5 * (Math.min(frame.width, frame.height) - 24),
      );
      // Rings don't outgrow the orbs.
      expect(ring.r / main.r).toBeLessThan(10);
    }
  });

  test("several planets keep the full ring, centred on the sun", () => {
    const roles = ["planner", "backend"].map((r) => agent(r, { parentId: null, agentType: r }));
    const l = layoutOrbit(orbit(roles), MIN_FRAME, 0);
    const sun = body(l, SUN_ID);
    expect([sun.x, sun.y]).toEqual([MIN_FRAME.width / 2, MIN_FRAME.height / 2]);
    expect(body(l, "planner").angle).not.toBe(
      body(layoutOrbit(orbit(roles), MIN_FRAME, 9e4), "planner").angle,
    );
  });

  test("is deterministic for the same t, and drifts slowly with t", () => {
    const input = orbit([agent("main"), ...crowd(4)]);
    const frame = { width: 800, height: 600 };
    expect(layoutOrbit(input, frame, 12_345)).toEqual(layoutOrbit(input, frame, 12_345));
    const a = body(layoutOrbit(input, frame, 0), "main-k0");
    const b = body(layoutOrbit(input, frame, 1000), "main-k0");
    const moved = Math.hypot(a.x - b.x, a.y - b.y);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(10);
  });

  test("recomputing with an extra agent keeps everyone else nearly in place", () => {
    const frame = { width: 900, height: 700 };
    const before = layoutOrbit(orbit([agent("main"), ...crowd(4)]), frame, 5000);
    const after = layoutOrbit(orbit([agent("main"), ...crowd(4), agent("late")]), frame, 5000);
    // Ids own their place: the input order doesn't matter at all…
    const shuffled = layoutOrbit(orbit([agent("main"), ...crowd(4).reverse()]), frame, 5000);
    for (const b of before.bodies) expect(body(shuffled, b.id).angle).toBeCloseTo(b.angle, 9);
    // …and a newcomer only nudges its siblings along their ring.
    for (const b of before.bodies.filter((x) => x.kind === "moon")) {
      expect(Math.abs(body(after, b.id).angle - b.angle)).toBeLessThan(Math.PI / 2);
    }
  });

  test("collapses more than six moons into a swarm, keeping waiting and failed ones", () => {
    const kids = [
      ...crowd(7),
      agent("asks", { mood: "waiting", lifecycle: "waiting_user", spawnedAt: 1 }),
      agent("broke", { mood: "error", lifecycle: "failed", spawnedAt: 2 }),
      agent("old", { mood: "done", lifecycle: "done", spawnedAt: 9999, endedAt: 3 }),
    ];
    const l = layoutOrbit(orbit([agent("main"), ...kids]), MIN_FRAME, 0);
    const moons = l.bodies.filter((b) => b.kind === "moon").map((b) => b.id);
    expect(moons).toHaveLength(5);
    expect(moons).toContain("asks");
    expect(moons).toContain("broke");
    // Then the most recently spawned of the working ones.
    expect(moons).toEqual(expect.arrayContaining(["main-k6", "main-k5", "main-k4"]));
    const swarm = body(l, swarmId("main"));
    expect(swarm.kind).toBe("swarm");
    expect(swarm.count).toBe(5);
    expect(swarm.memberIds).toEqual(["main-k0", "main-k1", "main-k2", "main-k3", "old"]);
    expect(swarm.around).toBe("main");
  });

  test("exactly six moons stay individual", () => {
    const l = layoutOrbit(orbit([agent("main"), ...crowd(6)]), MIN_FRAME, 0);
    expect(l.bodies.filter((b) => b.kind === "moon")).toHaveLength(6);
    expect(l.bodies.some((b) => b.kind === "swarm")).toBe(false);
  });

  test("a swarm never hides a moon whose own subagent waits on you", () => {
    const kids = crowd(8);
    const waitingGrandchild = agent("deep", {
      parentId: "main-k0",
      mood: "waiting",
      lifecycle: "waiting_user",
    });
    const l = layoutOrbit(orbit([agent("main"), ...kids, waitingGrandchild]), MIN_FRAME, 0);
    expect(body(l, "main-k0").kind).toBe("moon");
    expect(body(l, "deep").around).toBe("main-k0");
  });

  test("finished moons shrink and fade, and go into the swarm first", () => {
    const l = layoutOrbit(
      orbit([
        agent("main"),
        agent("busy"),
        agent("fin", { mood: "done", lifecycle: "done", gaze: { kind: "closed" } }),
      ]),
      MIN_FRAME,
      0,
    );
    expect(body(l, "fin").r).toBeLessThan(body(l, "busy").r);
    const failed = layoutOrbit(
      orbit([agent("main"), agent("busy"), agent("bad", { mood: "error", lifecycle: "failed" })]),
      MIN_FRAME,
      0,
    );
    // Failed is finished, but it still needs you: full size, full opacity.
    expect(body(failed, "bad")).toMatchObject({ r: body(failed, "busy").r, opacity: 1 });
    expect(body(l, "fin").opacity).toBeCloseTo(0.45);
    expect(body(l, "busy").opacity).toBe(1);

    const many = [
      ...crowd(3, "main", { lifecycle: "done", mood: "done" }),
      ...crowd(4).map((a) => ({ ...a, id: `${a.id}-live` })),
    ];
    const s = layoutOrbit(orbit([agent("main"), ...many]), MIN_FRAME, 0);
    const swarm = body(s, swarmId("main"));
    expect(swarm.memberIds?.every((id) => id.startsWith("main-k") && !id.endsWith("live"))).toBe(
      true,
    );
  });

  test("moons of moons orbit their moon, smaller still", () => {
    const l = layoutOrbit(
      orbit([agent("main"), agent("m1"), agent("mm1", { parentId: "m1" })]),
      MIN_FRAME,
      0,
    );
    const mm = body(l, "mm1");
    expect(mm.around).toBe("m1");
    expect(mm.parentId).toBe("m1");
    expect(mm.depth).toBe(2);
    expect(mm.r).toBeLessThan(body(l, "m1").r);
    expect(l.rings.find((r) => r.around === "m1")).toBeTruthy();
  });

  test("several planets share the sun's ring, evenly spaced", () => {
    const roles = ["planner", "backend", "frontend"].map((r) =>
      agent(r, { parentId: null, agentType: r }),
    );
    const l = layoutOrbit(orbit(roles), MIN_FRAME, 0);
    const planets = l.bodies.filter((b) => b.kind === "planet");
    expect(planets).toHaveLength(3);
    const angles = planets.map((p) => p.angle).sort((a, b) => a - b);
    expect(angles[1]! - angles[0]!).toBeCloseTo((Math.PI * 2) / 3, 6);
  });

  test("fits the minimum frame without overlaps, crowded and nested", () => {
    const cases = [
      [agent("main")],
      [agent("main"), ...crowd(6)],
      [agent("main"), ...crowd(30)],
      [agent("main"), ...crowd(6), ...crowd(6, "main-k0"), ...crowd(3, "main-k0-k0")],
      ["planner", "backend", "frontend", "design", "tests"].flatMap((r) => [
        agent(r, { parentId: null, agentType: r }),
        ...crowd(4, r),
      ]),
    ];
    for (const agents of cases) {
      for (const t of [0, 7_777, 61_000]) {
        expectFitsWithoutOverlap(layoutOrbit(orbit(agents), MIN_FRAME, t));
      }
    }
  });

  test("orphans whose parent isn't known become planets", () => {
    const l = layoutOrbit(orbit([agent("lost", { parentId: "gone" })]), MIN_FRAME, 0);
    expect(body(l, "lost").kind).toBe("planet");
    expect(body(l, "lost").parentId).toBeNull();
  });
});
