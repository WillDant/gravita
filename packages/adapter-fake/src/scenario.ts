import type { GravitaEvent } from "@gravita/protocol";
import { codexSessions } from "./codex";
import type { Timed } from "./script";
import { squadSessions } from "./squad";
import { DEMO_PROJECTS, landingSession, oauthSessions, projectDiscovered } from "./stories";
import { swarmSessions } from "./swarm";

export interface ScenarioOptions {
  /** Same seed → same ids, texts and timings. Default 1. */
  seed?: number;
  /** Playback speed; 2 plays twice as fast. Default 1. */
  speed?: number;
  /** Clock for the start timestamp. Default Date.now. */
  now?: () => number;
}

function* merge(a: Iterator<Timed, never>, b: Iterator<Timed, never>): Generator<Timed, never> {
  let x = a.next().value;
  let y = b.next().value;
  for (;;) {
    if (x.at <= y.at) {
      yield x;
      x = a.next().value;
    } else {
      yield y;
      y = b.next().value;
    }
  }
}

/** The squad story starts a little after the others, so the first sessions settle first. */
export const SQUAD_START_MS = 8_000;

/** The Codex story joins once the map is busy, so it reads as one more line among them. */
export const CODEX_START_MS = 12_000;

/** The endless demo story, in virtual time (ms since start). */
export function* timeline(seed: number): Generator<Timed, never> {
  yield projectDiscovered(DEMO_PROJECTS.gravita);
  yield projectDiscovered(DEMO_PROJECTS.landing);
  yield projectDiscovered(DEMO_PROJECTS.payments);
  yield projectDiscovered(DEMO_PROJECTS.todo);
  yield projectDiscovered(DEMO_PROJECTS.build);
  return yield* merge(
    merge(
      merge(merge(oauthSessions(seed, 0), landingSession(seed, 2_500)), swarmSessions(seed, 5_000)),
      squadSessions(seed, SQUAD_START_MS),
    ),
    codexSessions(seed, CODEX_START_MS),
  );
}

const stamp = (t: Timed, base: number, speed: number): GravitaEvent => ({
  ...t.event,
  ts: new Date(base + t.at / speed).toISOString(),
});

/** Every event of the first `untilMs` of virtual time, stamped as `startScenario` would. */
export function scenarioEvents(opts: ScenarioOptions, untilMs: number): GravitaEvent[] {
  const speed = opts.speed ?? 1;
  const base = (opts.now ?? Date.now)();
  const out: GravitaEvent[] = [];
  for (const t of timeline(opts.seed ?? 1)) {
    if (t.at > untilMs) break;
    out.push(stamp(t, base, speed));
  }
  return out;
}

/** Plays the demo in real time (scaled by `speed`). Returns a function that stops it. */
export function startScenario(
  opts: ScenarioOptions,
  onEvent: (e: GravitaEvent) => void,
): () => void {
  const speed = opts.speed ?? 1;
  const base = (opts.now ?? Date.now)();
  const it = timeline(opts.seed ?? 1);
  let next = it.next().value;
  const t0 = performance.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = () => {
    const virtual = (performance.now() - t0) * speed;
    while (!stopped && next.at <= virtual) {
      onEvent(stamp(next, base, speed));
      next = it.next().value;
    }
    if (!stopped) timer = setTimeout(tick, Math.max(1, (next.at - virtual) / speed));
  };
  timer = setTimeout(tick, 0);

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
