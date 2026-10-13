import { allocateMotion, type MotionCandidate } from "../motion-budget";
import { bezier, DURATION, EASE, ORB_MOTION } from "../tokens/motion";
import {
  layoutOrbit,
  MIN_FRAME,
  type OrbitBody,
  type OrbitInput,
  type OrbitLayout,
} from "./layout";
import { type Ctx2D, LIGHT_THEME, type OrbitTheme, type PathFactory, paintOrbit } from "./paint";

// The Orbit scene: one rAF loop outside React that lays out and paints the orbit, paced
// to what is moving. 60 fps only while something is in flight (a spawn pop, a body gliding
// to a new place); 30 fps otherwise, loops included (breathing, drift, the bounce and halo
// of an agent waiting on you, which can last for hours); nothing while the window is
// hidden; and with reduced motion no loop at all, just a redraw on change.

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface SceneEnv {
  raf(cb: (ts: number) => void): number;
  cancelRaf(id: number): void;
  /** ms; poses, drift and pops all run on this clock. */
  now(): number;
  visibility: VisibilitySource | null;
  makePath?: PathFactory;
}

export interface OrbitSceneOptions {
  /** Null where there is no canvas (tests, jsdom): the scene still lays out and emits positions. */
  ctx: Ctx2D | null;
  env?: Partial<SceneEnv>;
  theme?: OrbitTheme;
  reducedMotion?: boolean;
}

export interface SceneStats {
  fps: 0 | 30 | 60;
  /** Orbs currently allowed primary motion (the 1/3 budget). */
  primaryCount: number;
  /** Orbs drawn individually (planets and moons; not the sun, not swarm members). */
  visible: number;
  paints: number;
  running: boolean;
}

/** A 60 Hz display meets a 30 fps target every other frame, despite timer jitter. */
const FRAME_SLACK = 4;
/** Positions reach the DOM overlay at most ~10 times a second. */
const EMIT_EVERY = 100;
const MOVE_EPS = 0.5;
const ease = /* @__PURE__ */ bezier(EASE.signature);

interface Polar {
  /** Absolute position, used only by bodies that circle nothing (the sun). */
  x: number;
  y: number;
  angle: number;
  orbitRadius: number;
  r: number;
  opacity: number;
}

function defaultEnv(): SceneEnv {
  const g = globalThis as {
    requestAnimationFrame?: (cb: (ts: number) => void) => number;
    cancelAnimationFrame?: (id: number) => void;
    document?: VisibilitySource;
  };
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let next = 1;
  return {
    raf:
      g.requestAnimationFrame?.bind(g) ??
      ((cb) => {
        const id = next++;
        timers.set(
          id,
          setTimeout(() => {
            timers.delete(id);
            cb(Date.now());
          }, 16),
        );
        return id;
      }),
    cancelRaf:
      g.cancelAnimationFrame?.bind(g) ??
      ((id) => {
        clearTimeout(timers.get(id));
        timers.delete(id);
      }),
    now: () => Date.now(),
    visibility: g.document ?? null,
  };
}

/** Shortest signed turn from a to b. */
function turn(a: number, b: number): number {
  const d = (b - a) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}

export class OrbitScene {
  private readonly ctx: Ctx2D | null;
  private readonly env: SceneEnv;
  private theme: OrbitTheme;
  private reduced: boolean;
  private hidden: boolean;
  private input: OrbitInput | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private focusId: string | null = null;
  private selectedId: string | null = null;
  private hoverId: string | null = null;

  private shown: OrbitLayout | null = null;
  private readonly tweens = new Map<string, { from: Polar; start: number }>();
  /** When each agent first appeared; -Infinity for those already there on the first input. */
  private readonly seen = new Map<string, number>();
  private candidates: MotionCandidate[] = [];
  private primary: ReadonlySet<string> = new Set();
  private reallocAt = Number.POSITIVE_INFINITY;

  private rafId: number | null = null;
  private lastPaint = Number.NEGATIVE_INFINITY;
  private lastEmit = Number.NEGATIVE_INFINITY;
  private dirty = false;
  private forceEmit = false;
  private paints = 0;
  private destroyed = false;
  private readonly listeners = new Set<(bodies: readonly OrbitBody[]) => void>();

  constructor(opts: OrbitSceneOptions) {
    this.ctx = opts.ctx;
    this.env = { ...defaultEnv(), ...opts.env };
    this.theme = opts.theme ?? LIGHT_THEME;
    this.reduced = opts.reducedMotion === true;
    this.hidden = this.env.visibility?.hidden ?? false;
    this.env.visibility?.addEventListener("visibilitychange", this.onVisibility);
  }

  setInput(input: OrbitInput): void {
    if (this.destroyed) return;
    const now = this.env.now();
    const before = this.compose(now);
    const first = this.input === null;
    this.input = input;
    for (const a of input.agents) {
      if (!this.seen.has(a.id)) this.seen.set(a.id, first ? Number.NEGATIVE_INFINITY : now);
    }
    const after = this.compose(now);
    if (before && after) this.startTweens(before, after, now);

    // Which orbs are visible depends on the input alone, not on the frame or the time.
    const structure = after ?? layoutOrbit(input, MIN_FRAME, 0);
    this.candidates = structure.bodies.flatMap((b): MotionCandidate[] => {
      if (!b.agent) return [];
      const at = this.seen.get(b.id);
      return [
        {
          id: b.id,
          mood: b.agent.mood,
          ...(at !== undefined && Number.isFinite(at) ? { spawnedAt: at } : {}),
          ...(b.agent.changedAt !== undefined ? { changedAt: b.agent.changedAt } : {}),
        },
      ];
    });
    this.reallocate(now);
    this.invalidate(true);
  }

  /** CSS px and device pixel ratio; the caller sizes the canvas backing store. */
  resize(width: number, height: number, dpr = 1): void {
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.invalidate(true);
  }

  setTheme(theme: OrbitTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.invalidate(false);
  }

  setReducedMotion(on: boolean): void {
    if (on === this.reduced) return;
    this.reduced = on;
    if (on) this.cancel();
    this.tweens.clear();
    this.reallocate(this.env.now());
    this.invalidate(true);
  }

  /** Keyboard focus (a focus-blue ring); keep it for :focus-visible, not mouse clicks. */
  setFocus(id: string | null): void {
    if (id === this.focusId) return;
    this.focusId = id;
    this.invalidate(false);
  }

  /** The open agent (an ink ring). */
  setSelected(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.invalidate(false);
  }

  /** Repaints now (or on the next frame): after web fonts load, say. */
  redraw(): void {
    this.invalidate(false);
  }

  setHover(id: string | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.invalidate(false);
  }

  /** The body under (x, y) in CSS px, nearest centre first, with a little slop. */
  pick(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const b of this.shown?.bodies ?? []) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d <= b.r + 4 && d < bestD) {
        best = b.id;
        bestD = d;
      }
    }
    return best;
  }

  /** Body positions for the DOM overlay, at most ~10 Hz (and at once on structural change). */
  onPositions(cb: (bodies: readonly OrbitBody[]) => void): () => void {
    this.listeners.add(cb);
    if (this.shown) cb(this.shown.bodies);
    return () => this.listeners.delete(cb);
  }

  stats(): SceneStats {
    return {
      fps: this.fps(this.env.now()),
      primaryCount: this.primary.size,
      visible: this.candidates.length,
      paints: this.paints,
      running: this.rafId !== null,
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.cancel();
    this.env.visibility?.removeEventListener("visibilitychange", this.onVisibility);
    this.listeners.clear();
  }

  private fps(now: number): 0 | 30 | 60 {
    if (this.reduced || !this.ctx) return 0;
    if (this.tweens.size > 0) return 60;
    for (const id of this.primary) if (this.spawnAge(id, now) !== undefined) return 60;
    return 30;
  }

  private looping(): boolean {
    return (
      !this.destroyed &&
      this.ctx !== null &&
      !this.reduced &&
      !this.hidden &&
      this.input !== null &&
      this.width > 0
    );
  }

  private readonly onVisibility = () => {
    this.hidden = this.env.visibility?.hidden ?? false;
    if (this.hidden) this.cancel();
    else this.invalidate(false);
  };

  private invalidate(structural: boolean) {
    if (this.destroyed) return;
    if (structural) this.forceEmit = true;
    if (this.looping()) {
      this.dirty = true;
      this.schedule();
    } else {
      this.render(this.env.now());
    }
  }

  private schedule() {
    if (this.rafId === null && this.looping()) this.rafId = this.env.raf(this.tick);
  }

  private cancel() {
    if (this.rafId !== null) this.env.cancelRaf(this.rafId);
    this.rafId = null;
  }

  private readonly tick = () => {
    this.rafId = null;
    if (!this.looping()) return;
    const now = this.env.now();
    if (now >= this.reallocAt) this.reallocate(now);
    if (this.dirty || now - this.lastPaint >= 1000 / this.fps(now) - FRAME_SLACK) {
      this.render(now);
    }
    this.schedule();
  };

  /** Re-runs the 1/3 budget; again once the youngest pop has played out. */
  private reallocate(now: number) {
    this.primary = this.reduced ? new Set() : allocateMotion(this.candidates, now);
    this.reallocAt = Number.POSITIVE_INFINITY;
    for (const c of this.candidates) {
      const end = (c.spawnedAt ?? Number.NEGATIVE_INFINITY) + ORB_MOTION.pop.duration;
      if (end > now && end < this.reallocAt) this.reallocAt = end;
    }
  }

  /** The layout as displayed at `now`: the target, with any glide still in progress. */
  private compose(now: number): OrbitLayout | null {
    if (!this.input || this.width <= 0 || this.height <= 0) return null;
    // Reduced motion freezes the drift, so redraws on change don't jump the orbits.
    const layout = layoutOrbit(
      this.input,
      { width: this.width, height: this.height },
      this.reduced ? 0 : now,
    );
    if (this.tweens.size === 0) return layout;

    const placed = new Map<string, OrbitBody>();
    const ringOf = new Map<string, number>();
    for (const b of layout.bodies) {
      const tw = this.tweens.get(b.id);
      if (tw) {
        const p = (now - tw.start) / DURATION.slow;
        if (p >= 1) this.tweens.delete(b.id);
        else {
          const k = ease(p);
          b.angle = tw.from.angle + turn(tw.from.angle, b.angle) * k;
          b.orbitRadius += (tw.from.orbitRadius - b.orbitRadius) * (1 - k);
          b.r += (tw.from.r - b.r) * (1 - k);
          b.opacity += (tw.from.opacity - b.opacity) * (1 - k);
          if (!b.around) {
            b.x += (tw.from.x - b.x) * (1 - k);
            b.y += (tw.from.y - b.y) * (1 - k);
          }
        }
      }
      // Glides are polar, around the (possibly gliding) parent, so systems move as one.
      const centre = b.around ? placed.get(b.around) : undefined;
      if (centre) {
        b.x = centre.x + b.orbitRadius * Math.cos(b.angle);
        b.y = centre.y + b.orbitRadius * Math.sin(b.angle);
        if (!ringOf.has(b.around ?? "")) ringOf.set(b.around ?? "", b.orbitRadius);
      }
      placed.set(b.id, b);
    }
    for (const ring of layout.rings) {
      const c = placed.get(ring.around);
      if (c) {
        ring.cx = c.x;
        ring.cy = c.y;
      }
      ring.r = ringOf.get(ring.around) ?? ring.r;
    }
    for (const id of this.tweens.keys()) if (!placed.has(id)) this.tweens.delete(id);
    return layout;
  }

  /** Bodies that changed place on an input change glide there instead of jumping. */
  private startTweens(before: OrbitLayout, after: OrbitLayout, now: number) {
    if (this.reduced) return;
    const prev = new Map(before.bodies.map((b) => [b.id, b]));
    for (const b of after.bodies) {
      const p = prev.get(b.id);
      if (!p) continue;
      const moved =
        Math.abs(turn(p.angle, b.angle)) * Math.max(p.orbitRadius, b.orbitRadius) > MOVE_EPS ||
        Math.abs(p.orbitRadius - b.orbitRadius) > MOVE_EPS ||
        Math.abs(p.r - b.r) > MOVE_EPS ||
        Math.abs(p.opacity - b.opacity) > 0.01 ||
        (!b.around && Math.hypot(p.x - b.x, p.y - b.y) > MOVE_EPS);
      if (moved) {
        this.tweens.set(b.id, {
          from: {
            x: p.x,
            y: p.y,
            angle: p.angle,
            orbitRadius: p.orbitRadius,
            r: p.r,
            opacity: p.opacity,
          },
          start: now,
        });
      }
    }
  }

  private spawnAge(id: string, now: number): number | undefined {
    const at = this.seen.get(id);
    if (at === undefined || !Number.isFinite(at) || !this.primary.has(id)) return undefined;
    const age = now - at;
    return age < ORB_MOTION.pop.duration ? age : undefined;
  }

  private render(now: number) {
    const layout = this.compose(now);
    if (!layout) return;
    this.shown = layout;
    // Hidden windows skip the paint but still place the overlay's buttons.
    const ctx = this.hidden ? null : this.ctx;
    if (ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      paintOrbit(ctx, layout, now, this.theme, {
        primary: this.primary,
        reducedMotion: this.reduced,
        focusId: this.focusId,
        selectedId: this.selectedId,
        hoverId: this.hoverId,
        spawnAge: (id) => this.spawnAge(id, now),
        ...(this.env.makePath ? { makePath: this.env.makePath } : {}),
      });
      this.paints++;
    }
    this.lastPaint = now;
    this.dirty = false;
    if (this.listeners.size > 0 && (this.forceEmit || now - this.lastEmit >= EMIT_EVERY)) {
      this.forceEmit = false;
      this.lastEmit = now;
      for (const cb of this.listeners) cb(layout.bodies);
    }
  }
}
