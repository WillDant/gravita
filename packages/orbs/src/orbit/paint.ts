import type { Persona } from "@gravita/core";
import { glyphPath } from "../glyphs";
import { type MotionAllowance, orbPose, popIn } from "../rig";
import { type AgentColor, agentColor } from "../tokens/palette";
import type { OrbitBody, OrbitLayout } from "./layout";

// Canvas painting for the Orbit lens. The orb is drawn in the SVG orb's own 40×40 box
// (features/agents/Orb.tsx) with the same numbers, so both lenses show the same character.

/** An opaque path object (a Path2D in the browser). */
export type OrbitPath = object;
export type PathFactory = (d: string) => OrbitPath | null;

/** The slice of CanvasRenderingContext2D the painter uses; a real context satisfies it. */
export interface Ctx2D {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(angle: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
  ): void;
  fill(): void;
  stroke(path?: OrbitPath): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export interface OrbitTheme {
  ground: string;
  ink: string;
  waiting: string;
  error: string;
  ring: string;
  muted: string;
  text: string;
  /** Keyboard focus ring (styles.css --focus). */
  focus: string;
}

/** styles.css, light: ground, ink, waiting, error, hairline-strong, ink-3, ink, focus. */
export const LIGHT_THEME: OrbitTheme = {
  ground: "#ffffff",
  ink: "#121417",
  waiting: "#e8590c",
  error: "#d92d20",
  ring: "#cfd3da",
  muted: "#646b78",
  text: "#121417",
  focus: "#2f5bea",
};

/** styles.css, dark. */
export const DARK_THEME: OrbitTheme = {
  ground: "#0f1115",
  ink: "#eceef2",
  waiting: "#ff8a3d",
  error: "#ff6b5e",
  ring: "#353b47",
  muted: "#9098a6",
  text: "#eceef2",
  focus: "#7f9cff",
};

const FONT = '"DM Sans Variable", ui-sans-serif, system-ui, sans-serif';
const TAU = Math.PI * 2;
/** Eye whites, pupils and glints are fixed colours in the SVG orb too. */
const WHITE = "#ffffff";
const PUPIL = "#121417";

const defaultMakePath: PathFactory = (d) => {
  const P = (globalThis as { Path2D?: new (d: string) => OrbitPath }).Path2D;
  return P ? new P(d) : null;
};

// Parsing path data is the costly part; each glyph is built once per factory.
const pathCache = /* @__PURE__ */ new WeakMap<PathFactory, Map<string, OrbitPath | null>>();
function glyphShape(id: string, make: PathFactory): OrbitPath | null {
  let cache = pathCache.get(make);
  if (!cache) {
    cache = new Map();
    pathCache.set(make, cache);
  }
  if (!cache.has(id)) {
    const d = glyphPath(id);
    cache.set(id, d ? make(d) : null);
  }
  return cache.get(id) ?? null;
}

function circle(ctx: Ctx2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

function oval(ctx: Ctx2D, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
}

export interface PaintOrbOptions {
  /** Centre, in canvas px. */
  x: number;
  y: number;
  /** Rendered diameter, like the SVG orb's `size`. */
  size: number;
  color: AgentColor;
  persona: Pick<Persona, "mood" | "gaze" | "glyph">;
  /** ms. */
  t: number;
  seed?: string;
  motion?: MotionAllowance;
  reducedMotion?: boolean;
  /** The state glyph badge (default on). */
  glyph?: boolean;
  /** ms since the orb appeared, for the spawn pop; omit for no pop. */
  spawnAge?: number;
  makePath?: PathFactory;
}

/** Paints one orb: halo, posed body, highlight, eyes, glyph badge. */
export function paintOrb(ctx: Ctx2D, o: PaintOrbOptions, theme: OrbitTheme): void {
  const pose = orbPose(o.persona, o.t, {
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
    ...(o.motion ? { motion: o.motion } : {}),
    ...(o.reducedMotion !== undefined ? { reducedMotion: o.reducedMotion } : {}),
  });
  const k = o.size / 40;

  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.spawnAge !== undefined) {
    const pop = popIn(o.spawnAge, o.reducedMotion);
    ctx.scale(pop.scale, pop.scale);
    ctx.globalAlpha *= pop.opacity;
  }
  ctx.scale(k, k);
  ctx.translate(-20, -20);

  if (pose.halo) {
    ctx.save();
    ctx.globalAlpha *= pose.halo.alpha;
    ctx.translate(20, 20);
    ctx.scale(pose.halo.scale, pose.halo.scale);
    circle(ctx, 0, 0, 18.5);
    ctx.strokeStyle = theme.waiting;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // The body group: bounce squashes from the bottom, everything else from the centre.
  ctx.save();
  const py = pose.pivot === "bottom" ? 37 : 20;
  ctx.translate(20 + pose.dx, py + pose.dy);
  if (pose.rotate) ctx.rotate(pose.rotate);
  ctx.scale(pose.sx, pose.sy);
  ctx.translate(-20, -py);

  ctx.save();
  ctx.globalAlpha *= pose.opacity;
  circle(ctx, 20, 20, 17);
  ctx.fillStyle = o.color.fill;
  ctx.fill();
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha *= 0.32;
  oval(ctx, 13.5, 11.5, 5.5, 3);
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = theme.ink;
  if (pose.eyes === "open") {
    ctx.save();
    // The blink squashes the eyes around their own centre line.
    ctx.translate(0, 19);
    ctx.scale(1, pose.blink);
    ctx.translate(0, -19);
    ctx.lineWidth = 0.8;
    ctx.fillStyle = WHITE;
    for (const ex of [14.5, 25.5]) {
      oval(ctx, ex, 19, 4.3, 5.1);
      ctx.fill();
      ctx.stroke();
    }
    const { dx, dy, r } = pose.pupil;
    for (const ex of [14.5, 25.5]) {
      ctx.fillStyle = PUPIL;
      circle(ctx, ex + dx, 19.4 + dy, r);
      ctx.fill();
      ctx.fillStyle = WHITE;
      circle(ctx, ex + 0.8 + dx, 18.4 + dy, 0.7);
      ctx.fill();
    }
    ctx.restore();
  } else {
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    if (pose.eyes === "smile") {
      ctx.moveTo(10.6, 20.5);
      ctx.quadraticCurveTo(14.5, 15.8, 18.4, 20.5);
      ctx.moveTo(21.6, 20.5);
      ctx.quadraticCurveTo(25.5, 15.8, 29.4, 20.5);
    } else {
      ctx.moveTo(11, 19.5);
      ctx.lineTo(18, 19.5);
      ctx.moveTo(22, 19.5);
      ctx.lineTo(29, 19.5);
    }
    ctx.stroke();
  }
  ctx.restore();

  if (o.glyph !== false) {
    const shape = glyphShape(o.persona.glyph, o.makePath ?? defaultMakePath);
    if (glyphPath(o.persona.glyph)) {
      circle(ctx, 33, 33, 7);
      ctx.fillStyle = theme.ground;
      ctx.fill();
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (shape) {
      ctx.save();
      ctx.translate(28.5, 28.5);
      ctx.scale(0.375, 0.375);
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(shape);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** The project at the centre: neutral on purpose, the agents carry the colour. */
function paintSun(ctx: Ctx2D, b: OrbitBody, theme: OrbitTheme) {
  circle(ctx, b.x, b.y, b.r);
  ctx.fillStyle = theme.ground;
  ctx.fill();
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = theme.text;
  ctx.font = `700 ${Math.round(b.r * 0.9)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(b.label ?? "", b.x, b.y + b.r * 0.05);
}

/** A crowd of moons: three small orbs in their own colours and a "×N" pill. */
function paintSwarm(ctx: Ctx2D, b: OrbitBody, theme: OrbitTheme) {
  const members = b.members ?? [];
  const dot = b.r * 0.46;
  const spots = [-Math.PI / 2, (Math.PI * 5) / 6, Math.PI / 6];
  spots.forEach((a, i) => {
    const m = members[i % Math.max(1, members.length)];
    circle(ctx, b.x + Math.cos(a) * b.r * 0.5, b.y + Math.sin(a) * b.r * 0.5, dot);
    ctx.fillStyle = m ? agentColor(m.agentType).fill : theme.ring;
    ctx.fill();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  });

  const text = `×${b.count ?? members.length}`;
  const size = Math.max(9, Math.min(11, b.r * 0.8));
  ctx.font = `700 ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + 8;
  const h = size + 5;
  const cx = b.x + b.r * 0.8;
  const cy = b.y + b.r * 0.8;
  ctx.beginPath();
  ctx.arc(cx - w / 2 + h / 2, cy, h / 2, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.arc(cx + w / 2 - h / 2, cy, h / 2, -Math.PI / 2, Math.PI / 2);
  ctx.closePath();
  ctx.fillStyle = theme.ground;
  ctx.fill();
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = theme.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy + 0.5);
}

export interface PaintOrbitOptions {
  /** Orbs allowed primary motion (the 1/3 budget); omitted means every orb may move. */
  primary?: ReadonlySet<string>;
  reducedMotion?: boolean;
  /** The open agent: an ink ring. */
  selectedId?: string | null;
  /** Keyboard focus: a focus-blue ring outside the selection ring. */
  focusId?: string | null;
  hoverId?: string | null;
  /** ms since a body appeared, for the spawn pop. */
  spawnAge?: (id: string) => number | undefined;
  makePath?: PathFactory;
}

function ring(ctx: Ctx2D, b: OrbitBody, gap: number, color: string, width: number) {
  circle(ctx, b.x, b.y, b.r + gap);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Paints a whole orbit layout: rings, sun, orbs, swarms, then hover, selection and focus. */
export function paintOrbit(
  ctx: Ctx2D,
  scene: OrbitLayout,
  t: number,
  theme: OrbitTheme,
  opts: PaintOrbitOptions = {},
): void {
  ctx.save();
  ctx.strokeStyle = theme.ring;
  ctx.lineWidth = 1;
  for (const ring of scene.rings) {
    circle(ctx, ring.cx, ring.cy, ring.r);
    ctx.stroke();
  }

  let focus: OrbitBody | undefined;
  let selected: OrbitBody | undefined;
  let hover: OrbitBody | undefined;
  for (const b of scene.bodies) {
    if (b.id === opts.focusId) focus = b;
    if (b.id === opts.selectedId) selected = b;
    if (b.id === opts.hoverId) hover = b;
    ctx.save();
    ctx.globalAlpha = b.opacity;
    if (b.kind === "sun") paintSun(ctx, b, theme);
    else if (b.kind === "swarm") paintSwarm(ctx, b, theme);
    else if (b.agent) {
      const a = b.agent;
      const size = b.r * 2;
      const age = opts.spawnAge?.(b.id);
      paintOrb(
        ctx,
        {
          x: b.x,
          y: b.y,
          size,
          color: agentColor(a.agentType),
          persona: { mood: a.mood, gaze: a.gaze ?? { kind: "wander" }, glyph: a.glyph ?? "dot" },
          t,
          seed: a.id,
          motion: !opts.primary || opts.primary.has(b.id) ? "primary" : "ambient",
          reducedMotion: opts.reducedMotion === true,
          // Below ~20px the badge is a smudge; the overlay's label carries the state.
          glyph: size >= 20,
          ...(age !== undefined ? { spawnAge: age } : {}),
          ...(opts.makePath ? { makePath: opts.makePath } : {}),
        },
        theme,
      );
      // Failure reads without the wobble, which the motion budget may hold back.
      if (a.mood === "error") ring(ctx, b, 2, theme.error, 2);
    }
    ctx.restore();
  }

  if (hover && hover !== selected) ring(ctx, hover, 4, theme.muted, 1.5);
  if (selected) ring(ctx, selected, 4, theme.ink, 2);
  if (focus) ring(ctx, focus, 7, theme.focus, 2);
  ctx.restore();
}
