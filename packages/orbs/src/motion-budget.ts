import type { Mood } from "@gravita/core";
import { ORB_MOTION } from "./tokens/motion";

// The 1/3 rule: at most about a third of the visible orbs play primary motion (the spawn
// pop, the "waiting for you" bounce, the error wobble) at once; the rest only breathe.
// A crowd that all bounces says nothing, and it costs CPU. State stays legible without
// motion: the orange halo, the glyph and the colour don't depend on the budget.

export interface MotionCandidate {
  id: string;
  mood: Mood;
  /** When the orb appeared (ms), for the spawn pop. */
  spawnedAt?: number;
  /** When its state last changed (ms); fresher changes win ties. */
  changedAt?: number;
}

/** Most urgent first: someone waiting on you, then a failure, then a fresh spawn. */
function rank(c: MotionCandidate, now: number): number | null {
  if (c.mood === "waiting") return 0;
  if (c.mood === "error") return 1;
  if (c.spawnedAt !== undefined && now - c.spawnedAt < ORB_MOTION.pop.duration) return 2;
  return null;
}

export function motionCap(visible: number): number {
  return Math.max(1, Math.floor(visible / 3));
}

/** Ids of the orbs allowed primary motion right now. Deterministic for the same inputs. */
export function allocateMotion(candidates: readonly MotionCandidate[], now: number): Set<string> {
  const wanting = candidates
    .map((c) => ({ c, r: rank(c, now) }))
    .filter((x): x is { c: MotionCandidate; r: number } => x.r !== null)
    .sort(
      (a, b) =>
        a.r - b.r ||
        (b.c.changedAt ?? 0) - (a.c.changedAt ?? 0) ||
        (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0),
    );
  return new Set(wanting.slice(0, motionCap(candidates.length)).map((x) => x.c.id));
}
