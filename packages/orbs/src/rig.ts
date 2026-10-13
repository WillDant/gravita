import type { Mood, Persona } from "@gravita/core";
import { type Bezier, bezier, EASE, ORB_MOTION } from "./tokens/motion";

// The persona rig: what an orb looks like at time t, as numbers. Pure and deterministic,
// so the canvas scene, tests and the gallery all agree. It mirrors the CSS keyframes the
// SVG orb uses (styles.css), sharing the timings in tokens/motion.

/** Body motion per mood. `bounce` and `wobble` are primary motion; the rest is ambience. */
export type BodyMotion = "breathe" | "bob" | "bounce" | "wobble" | "still";

const BODY: Record<Mood, BodyMotion> = {
  idle: "breathe",
  thinking: "breathe",
  focused: "breathe",
  busy: "bob",
  delegating: "bob",
  waiting: "bounce",
  error: "wobble",
  blocked: "still",
  done: "still",
  stopped: "still",
  away: "still",
};

export const PRIMARY_MOTION: ReadonlySet<BodyMotion> = new Set(["bounce", "wobble"]);

/**
 * The body motion an orb plays. With an `ambient` allowance (the 1/3 budget said no),
 * primary motion falls back to breathing; the halo, glyph and colour still tell the state.
 */
export function bodyMotion(mood: Mood, motion: MotionAllowance = "primary"): BodyMotion {
  const m = BODY[mood];
  return motion === "ambient" && PRIMARY_MOTION.has(m) ? "breathe" : m;
}

export function breathPeriod(mood: Mood): number {
  const b = ORB_MOTION.breathe;
  return mood === "thinking" ? b.thinking : mood === "idle" ? b.idle : b.working;
}

export interface Pupil {
  dx: number;
  dy: number;
  r: number;
}

/** Where the pupils look, in the orb's 40×40 box: toward the tool, up, at you, at a child. */
export function pupilOffset(p: Pick<Persona, "gaze" | "mood">): Pupil {
  switch (p.gaze.kind) {
    case "tool":
      return { dx: 1.5, dy: 0.4, r: 2.1 };
    case "up":
      return { dx: 0.4, dy: -1.9, r: 2 };
    case "viewer":
      return { dx: 0, dy: 0.6, r: 2.7 };
    case "child":
      return { dx: 1.1, dy: 1.7, r: 2.1 };
    default:
      return { dx: 0, dy: 0, r: p.mood === "error" ? 1.3 : 2.1 };
  }
}

export type MotionAllowance = "primary" | "ambient";

export interface PoseOptions {
  /** Phase seed (an agent id), so a crowd of orbs doesn't breathe in lockstep. */
  seed?: string;
  motion?: MotionAllowance;
  reducedMotion?: boolean;
}

export interface OrbPose {
  motion: BodyMotion;
  /** Body transform in the 40×40 box; the pivot is the centre, or the bottom for a bounce. */
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  /** Radians. */
  rotate: number;
  pivot: "center" | "bottom";
  eyes: "open" | "closed" | "smile";
  /** Eye openness, 1 = open (blink squashes it). */
  blink: number;
  pupil: Pupil;
  /** The orange "waiting for you" halo; scale and alpha of its pulse. */
  halo: { scale: number; alpha: number } | null;
  opacity: number;
}

type Frame = { at: number; v: readonly number[] };

/** Evaluates CSS-style keyframes at progress p (0..1), easing each segment. */
function keyframes(frames: readonly Frame[], p: number, ease: (x: number) => number): number[] {
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    if (p <= b.at) {
      const span = b.at - a.at;
      const k = span > 0 ? ease((p - a.at) / span) : 1;
      return a.v.map((v, j) => v + (b.v[j]! - v) * k);
    }
  }
  return [...frames.at(-1)!.v];
}

const easeInOut = bezier(EASE.inOut);
const easePop = bezier(EASE.pop);
const easeOut = bezier(EASE.out);
const cssEase = bezier([0.25, 0.1, 0.25, 1] as Bezier);

const BOUNCE: Frame[] = [
  { at: 0, v: [0, 1, 1] },
  { at: 0.2, v: [-ORB_MOTION.bounce.lift, 0.97, 1.03] },
  { at: 0.35, v: [0, 1.04, 0.96] },
  { at: 0.6, v: [0, 1, 1] },
  { at: 1, v: [0, 1, 1] },
];
const WOBBLE: Frame[] = [
  { at: 0, v: [0] },
  { at: 0.25, v: [-ORB_MOTION.wobble.deg] },
  { at: 0.75, v: [ORB_MOTION.wobble.deg] },
  { at: 1, v: [0] },
];
const BLINK: Frame[] = [
  { at: 0, v: [1] },
  { at: 0.94, v: [1] },
  { at: 0.965, v: [0.1] },
  { at: 1, v: [1] },
];
const WANDER: Frame[] = [
  { at: 0, v: [0, 0] },
  { at: 0.2, v: [1.2, -0.6] },
  { at: 0.45, v: [-1, 0.4] },
  { at: 0.7, v: [0.6, 0.8] },
  { at: 1, v: [0, 0] },
];

function seedPhase(seed: string | undefined): number {
  if (!seed) return 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const progress = (t: number, period: number, phase: number) => (((t / period + phase) % 1) + 1) % 1;

/** The orb's pose at time t (ms). Same inputs, same pose. */
export function orbPose(
  persona: Pick<Persona, "mood" | "gaze">,
  t: number,
  opts: PoseOptions = {},
): OrbPose {
  const { mood, gaze } = persona;
  const motion = bodyMotion(mood, opts.motion);
  const still = opts.reducedMotion === true;
  const phase = seedPhase(opts.seed);
  const closed = gaze.kind === "closed";
  const base = pupilOffset(persona);

  const pose: OrbPose = {
    motion,
    sx: 1,
    sy: 1,
    dx: 0,
    dy: 0,
    rotate: 0,
    pivot: motion === "bounce" ? "bottom" : "center",
    eyes: closed ? (mood === "done" ? "smile" : "closed") : "open",
    blink: 1,
    pupil: { ...base },
    halo: mood === "waiting" ? { scale: 1, alpha: 1 } : null,
    opacity: mood === "stopped" || mood === "away" ? 0.45 : 1,
  };
  if (still) return pose;

  switch (motion) {
    case "breathe": {
      const p = progress(t, breathPeriod(mood), phase);
      const s = 1 + (ORB_MOTION.breathe.scale - 1) * (0.5 - 0.5 * Math.cos(2 * Math.PI * p));
      pose.sx = s;
      pose.sy = s;
      break;
    }
    case "bob": {
      const p = progress(t, ORB_MOTION.bob.period, phase);
      pose.dy = -ORB_MOTION.bob.lift * (0.5 - 0.5 * Math.cos(2 * Math.PI * p));
      break;
    }
    case "bounce": {
      const [dy, sx, sy] = keyframes(BOUNCE, progress(t, ORB_MOTION.bounce.period, phase), easePop);
      pose.dy = dy!;
      pose.sx = sx!;
      pose.sy = sy!;
      break;
    }
    case "wobble": {
      const [deg] = keyframes(WOBBLE, progress(t, ORB_MOTION.wobble.period, phase), easeInOut);
      pose.rotate = (deg! * Math.PI) / 180;
      break;
    }
    case "still":
      break;
  }

  if (pose.eyes === "open") {
    pose.blink = keyframes(BLINK, progress(t, ORB_MOTION.blink.period, phase), cssEase)[0]!;
    if (gaze.kind === "wander") {
      const [wx, wy] = keyframes(WANDER, progress(t, ORB_MOTION.wander.period, phase), easeInOut);
      pose.pupil.dx += wx!;
      pose.pupil.dy += wy!;
    }
  }
  if (pose.halo) {
    const [scale, alpha] = keyframes(
      [
        { at: 0, v: [0.85, 0.7] },
        { at: 1, v: [1.6, 0] },
      ],
      progress(t, ORB_MOTION.halo.period, phase),
      easeOut,
    );
    pose.halo = { scale: scale!, alpha: alpha! };
  }
  return pose;
}

/** The spawn pop: scale and opacity `age` ms after an orb appeared (1 and 1 once done). */
export function popIn(age: number, reducedMotion = false): { scale: number; opacity: number } {
  const { duration, from } = ORB_MOTION.pop;
  if (reducedMotion || age >= duration) return { scale: 1, opacity: 1 };
  const x = Math.max(0, age) / duration;
  return { scale: from + (1 - from) * easePop(x), opacity: x };
}
