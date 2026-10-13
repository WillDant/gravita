import { describe, expect, test } from "bun:test";
import {
  DARK_THEME,
  layoutOrbit,
  type OrbitBody,
  OrbitScene,
  paintOrbit,
  SUN_ID,
  swarmId,
} from "../src";
import { agent, FakeEnv, fakePath, orbit, RecordingCtx } from "./orbit-fakes";

function sceneWith(env: FakeEnv, ctx: RecordingCtx | null, reducedMotion = false) {
  return new OrbitScene({
    ctx,
    env: {
      raf: env.raf,
      cancelRaf: env.cancelRaf,
      now: env.now,
      visibility: env.visibility,
      makePath: fakePath,
    },
    reducedMotion,
  });
}

const calm = orbit([agent("main", { mood: "thinking" }), agent("a1")]);
const needsYou = orbit([
  agent("main", { mood: "waiting", lifecycle: "waiting_user" }),
  agent("a1"),
]);

describe("OrbitScene pacing", () => {
  test("ambient only: 30 fps", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx());
    scene.resize(400, 300);
    scene.setInput(calm);
    const start = scene.stats().paints;
    env.frame(60);
    expect(scene.stats().fps).toBe(30);
    expect(scene.stats().paints - start).toBeGreaterThanOrEqual(29);
    expect(scene.stats().paints - start).toBeLessThanOrEqual(31);
  });

  test("an orb waiting on you bounces at 30 fps: waiting can last for hours", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx());
    scene.resize(400, 300);
    scene.setInput(needsYou);
    const start = scene.stats().paints;
    env.frame(60);
    expect(scene.stats()).toMatchObject({ fps: 30, primaryCount: 1 });
    expect(scene.stats().paints - start).toBeLessThanOrEqual(31);
  });

  test("60 fps only while a glide is in flight", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx());
    scene.resize(400, 300);
    scene.setInput(calm);
    env.frame(2);
    // A second planet: the sun moves to the centre and the first planet glides to its ring.
    scene.setInput(orbit([...calm.agents, agent("r2", { parentId: null, agentType: "Plan" })]));
    expect(scene.stats().fps).toBe(60);
    const start = scene.stats().paints;
    env.frame(20);
    expect(scene.stats().paints - start).toBeGreaterThanOrEqual(19);
    env.frame(20);
    expect(scene.stats().fps).toBe(30);
  });

  test("a fresh spawn plays at 60 fps until its pop ends, then settles to 30", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx());
    scene.resize(400, 300);
    scene.setInput(calm);
    env.frame(2);
    scene.setInput(orbit([...calm.agents, agent("a2")]));
    expect(scene.stats().primaryCount).toBe(1);
    expect(scene.stats().fps).toBe(60);
    env.frame(40); // > 480 ms of pop and glide
    expect(scene.stats().primaryCount).toBe(0);
    expect(scene.stats().fps).toBe(30);
  });

  test("pauses while the window is hidden and resumes when it's back", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx());
    scene.resize(400, 300);
    scene.setInput(calm);
    env.frame(4);
    env.setHidden(true);
    expect(env.pending).toBe(0);
    const paused = scene.stats().paints;
    let emits = 0;
    scene.onPositions(() => emits++);
    env.frame(30);
    scene.setInput(needsYou); // changes while hidden don't paint either…
    expect(scene.stats().paints).toBe(paused);
    expect(emits).toBe(2); // …but the overlay's buttons still find their orbs
    expect(scene.stats().running).toBe(false);

    env.setHidden(false);
    env.frame(10);
    expect(scene.stats().paints).toBeGreaterThanOrEqual(paused + 5);
    expect(scene.stats().running).toBe(true);
  });

  test("reduced motion: no loop, one redraw per change", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx(), true);
    scene.resize(400, 300);
    scene.setInput(needsYou);
    expect(env.pending).toBe(0);
    const once = scene.stats().paints;
    expect(once).toBeGreaterThan(0);
    env.frame(30);
    expect(scene.stats().paints).toBe(once);
    expect(scene.stats()).toMatchObject({ fps: 0, primaryCount: 0, running: false });

    scene.setInput(calm);
    expect(scene.stats().paints).toBe(once + 1);
    scene.setFocus("a1");
    scene.setTheme(DARK_THEME);
    expect(scene.stats().paints).toBe(once + 3);
    expect(env.pending).toBe(0);
  });

  test("switching reduced motion on stops the loop", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx());
    scene.resize(400, 300);
    scene.setInput(needsYou);
    env.frame(2);
    scene.setReducedMotion(true);
    expect(env.pending).toBe(0);
    scene.setReducedMotion(false);
    expect(env.pending).toBe(1);
  });

  test("at most a third of the visible orbs get primary motion", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx());
    scene.resize(800, 600);
    const crowd = Array.from({ length: 9 }, (_, i) =>
      agent(`r${i}`, { parentId: null, mood: "waiting", lifecycle: "waiting_user" }),
    );
    scene.setInput(orbit(crowd));
    expect(scene.stats().visible).toBe(9);
    expect(scene.stats().primaryCount).toBe(3);
  });
});

describe("OrbitScene overlay and picking", () => {
  test("without a canvas it still lays out and emits positions", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, null);
    const seen: (readonly OrbitBody[])[] = [];
    scene.onPositions((b) => seen.push(b));
    scene.resize(360, 300);
    scene.setInput(calm);
    expect(env.pending).toBe(0);
    expect(seen.at(-1)?.map((b) => b.id)).toEqual([SUN_ID, "main", "a1"]);
    expect(scene.stats().paints).toBe(0);
  });

  test("positions reach the overlay at most ~10 times a second", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx());
    let emits = 0;
    scene.onPositions(() => emits++);
    scene.resize(400, 300);
    scene.setInput(needsYou);
    env.frame(120); // two seconds at 60 fps
    expect(emits).toBeGreaterThanOrEqual(15);
    expect(emits).toBeLessThanOrEqual(22);
  });

  test("pick finds the body under the pointer", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, null);
    let bodies: readonly OrbitBody[] = [];
    scene.onPositions((b) => {
      bodies = b;
    });
    scene.resize(400, 300);
    scene.setInput(calm);
    const a1 = bodies.find((b) => b.id === "a1");
    expect(a1).toBeTruthy();
    expect(scene.pick(a1!.x + 1, a1!.y - 1)).toBe("a1");
    const sun = bodies.find((b) => b.id === SUN_ID)!;
    expect(scene.pick(sun.x, sun.y)).toBe(SUN_ID);
    expect(scene.pick(1, 1)).toBeNull();
  });

  test("a body that changes place glides there", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx());
    let bodies: readonly OrbitBody[] = [];
    scene.onPositions((b) => {
      bodies = b;
    });
    scene.resize(400, 300);
    const kids = Array.from({ length: 6 }, (_, i) => agent(`k${i}`));
    scene.setInput(orbit([agent("main"), ...kids]));
    env.frame(1);
    const before = bodies.find((b) => b.id === "k0")!;
    scene.setInput(orbit([agent("main"), ...kids, agent("k6")])); // now a swarm
    env.frame(1);
    expect(bodies.some((b) => b.id === swarmId("main"))).toBe(true);
    const k0 = bodies.find((b) => b.id === "k0")!;
    expect(Math.hypot(k0.x - before.x, k0.y - before.y)).toBeLessThan(3);
    env.frame(40);
    expect(scene.stats().fps).toBe(30);
  });

  test("destroy stops everything", () => {
    const env = new FakeEnv();
    const scene = sceneWith(env, new RecordingCtx());
    scene.resize(400, 300);
    scene.setInput(needsYou);
    scene.destroy();
    expect(env.pending).toBe(0);
    scene.setInput(calm);
    expect(env.pending).toBe(0);
  });
});

describe("bench", () => {
  test("layout + paint of 60 bodies averages well under 4 ms a frame", () => {
    const agents = [
      ...["planner", "backend", "frontend", "design", "tests"].map((r) =>
        agent(r, { parentId: null, agentType: r }),
      ),
    ];
    let n = 0;
    for (const role of ["planner", "backend", "frontend", "design", "tests"]) {
      for (let i = 0; i < 5; i++) {
        const id = `${role}-${i}`;
        agents.push(agent(id, { parentId: role, mood: i === 0 ? "waiting" : "busy" }));
        for (let j = 0; j < 6 && n < 30; j++, n++) {
          agents.push(agent(`${id}-${j}`, { parentId: id, mood: "thinking" }));
        }
      }
    }
    const input = orbit(agents);
    const frame = { width: 1200, height: 800 };
    expect(layoutOrbit(input, frame, 0).bodies.length).toBeGreaterThanOrEqual(60);

    const ctx = new RecordingCtx(false);
    const frames = 200;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      const t = f * 16.7;
      paintOrbit(ctx, layoutOrbit(input, frame, t), t, DARK_THEME, { makePath: fakePath });
    }
    const avg = (performance.now() - t0) / frames;
    expect(avg).toBeLessThan(4);
  });
});
