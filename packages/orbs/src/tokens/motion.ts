// Gravita's motion identity, in one place for CSS (the SVG orb) and the canvas scene.
// Chrome is calm: 120/240/480 ms on the signature ease, never overshoot. Orbs are playful:
// slow sine breathing as ambience, overshoot only on spawn and "waiting for you".

export type Bezier = readonly [number, number, number, number];

export const DURATION = { fast: 120, base: 240, slow: 480 } as const;

export const EASE = {
  signature: [0.2, 0, 0, 1],
  pop: [0.34, 1.4, 0.64, 1],
  inOut: [0.42, 0, 0.58, 1],
  out: [0, 0, 0.58, 1],
} as const satisfies Record<string, Bezier>;

export const ORB_MOTION = {
  breathe: { thinking: 2400, working: 3200, idle: 4200, scale: 1.045 },
  bob: { period: 700, lift: 1.5 },
  bounce: { period: 1300, lift: 4 },
  wobble: { period: 900, deg: 6 },
  blink: { period: 4200 },
  wander: { period: 7000 },
  pop: { duration: DURATION.slow, from: 0.2 },
  halo: { period: 1600 },
  /** Pupils glide to a new gaze in this long. */
  gaze: DURATION.base,
} as const;

export const cssBezier = (b: Bezier) => `cubic-bezier(${b.join(",")})`;

/** A CSS cubic-bezier timing function, solved for x by Newton steps with a bisection fallback. */
export function bezier([x1, y1, x2, y2]: Bezier): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-5) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-5) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}
