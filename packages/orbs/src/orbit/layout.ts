import type { Gaze, Lifecycle, Mood } from "@gravita/core";

// The Orbit lens as geometry: the project is the sun, top-level agents are planets on a
// ring around it, subagents are moons of their parent (and moons of moons). Pure and
// deterministic for (input, frame, t), so the canvas, the DOM overlay and tests agree.

export interface OrbitAgent {
  id: string;
  parentId: string | null;
  agentType: string;
  mood: Mood;
  lifecycle: Lifecycle;
  /** Persona bits the painter needs; the layout itself only reads mood and lifecycle. */
  gaze?: Gaze;
  glyph?: string;
  /** Wall-clock ms, for ranking who stays visible when moons swarm. */
  spawnedAt?: number;
  endedAt?: number;
  /** When the state last changed (ms); breaks ties in the motion budget. */
  changedAt?: number;
}

export interface OrbitInput {
  project: { id: string; name: string; initial?: string };
  /** In spawn order; that order is also the keyboard order among siblings. */
  agents: readonly OrbitAgent[];
}

export interface OrbitFrame {
  width: number;
  height: number;
}

export type OrbitBodyKind = "sun" | "planet" | "moon" | "swarm";

export interface OrbitBody {
  id: string;
  kind: OrbitBodyKind;
  x: number;
  y: number;
  r: number;
  /** The agent's parent (null for the sun, planets and orphans). */
  parentId: string | null;
  /** The body this one circles: the sun for planets, the parent for moons. */
  around: string | null;
  /** Radians, already advanced by the ambient drift at t. */
  angle: number;
  orbitRadius: number;
  /** -1 for the sun, 0 for planets, 1+ for moons. */
  depth: number;
  opacity: number;
  agent?: OrbitAgent;
  /** Swarm only: how many agents it stands for, and who (direct members first). */
  count?: number;
  memberIds?: string[];
  members?: OrbitAgent[];
  /** Sun only: the project initial. */
  label?: string;
}

export interface OrbitRing {
  around: string;
  cx: number;
  cy: number;
  r: number;
  depth: number;
}

export interface OrbitLayout {
  width: number;
  height: number;
  /** Size multiplier applied to the natural orb sizes (1 = planet 36px). */
  scale: number;
  /** Parents before children, siblings in spawn order: also the keyboard order. */
  bodies: OrbitBody[];
  rings: OrbitRing[];
}

export const SUN_ID = "@sun";
export const swarmId = (parentId: string) => `@swarm:${parentId}`;

/** The smallest frame the lens promises to fit without overlaps. */
export const MIN_FRAME: OrbitFrame = { width: 360, height: 300 };
/** More moons than this around one parent collapse into a swarm… */
export const SWARM_OVER = 6;
/** …keeping this many individually, the ones that most need attention. */
export const SWARM_KEEP = 5;

// Natural radii in px. A planet is the line map's 30px head orb, a little bigger.
const R_SUN = 23;
const R_PLANET = 18;
const R_MOON = [13, 10, 8] as const;
const SETTLED_SHRINK = 0.8;
const SETTLED_OPACITY = 0.45;
const GAP = 8;
const MARGIN = 12;
/** Big frames spread the rings further but grow the orbs only a little. */
const MAX_SPREAD = 3;
const MAX_GROW = 1.6;
/**
 * A lone planet's system is the whole picture: its orbs may grow further, and its rings
 * outgrow the orbs only this much, so the system fills the pane and stays legible.
 */
const SOLO_GROW = 2.4;
const SOLO_SPREAD = 1.25;
/** One revolution, in ms: planets slowest, deeper moons a little quicker. */
const PERIOD = [180_000, 120_000, 90_000] as const;

const TAU = Math.PI * 2;

/** Done, stopped, failed or detached: finished work that steps back. */
export function isSettled(lifecycle: Lifecycle): boolean {
  return (
    lifecycle === "done" ||
    lifecycle === "stopped" ||
    lifecycle === "failed" ||
    lifecycle === "detached"
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const preferredAngle = (id: string) => (hash(id) / 4294967296) * TAU;

/** Lower is more urgent: waiting on you, failed, working, resting, finished. */
function urgency(a: OrbitAgent): number {
  if (a.mood === "waiting") return 0;
  if (a.mood === "error") return 1;
  if (isSettled(a.lifecycle)) return 4;
  return a.lifecycle === "active" ? 2 : 3;
}

interface Node {
  id: string;
  kind: OrbitBodyKind;
  depth: number;
  r: number;
  opacity: number;
  agent?: OrbitAgent;
  members?: OrbitAgent[];
  memberIds?: string[];
  kids: Node[];
  ringR: number;
  sys: number;
}

function moonRadius(depth: number): number {
  return R_MOON[Math.min(depth, R_MOON.length) - 1] ?? R_MOON[2];
}

/** Builds the visible tree: swarms collapse crowded parents, attention first. */
function buildTree(input: OrbitInput): Node {
  const byId = new Map(input.agents.map((a) => [a.id, a]));
  const kidsOf = new Map<string | null, OrbitAgent[]>();
  for (const a of input.agents) {
    const parent = a.parentId !== null && byId.has(a.parentId) ? a.parentId : null;
    const list = kidsOf.get(parent) ?? [];
    list.push(a);
    kidsOf.set(parent, list);
  }

  // A subtree is as urgent as its most urgent agent, so a swarm never hides a waiting grandchild.
  const subtreeUrgency = new Map<string, number>();
  const urgencyOf = (a: OrbitAgent): number => {
    const known = subtreeUrgency.get(a.id);
    if (known !== undefined) return known;
    subtreeUrgency.set(a.id, urgency(a)); // guards against parent cycles
    let u = urgency(a);
    for (const k of kidsOf.get(a.id) ?? []) u = Math.min(u, urgencyOf(k));
    subtreeUrgency.set(a.id, u);
    return u;
  };
  const descendants = (a: OrbitAgent, out: OrbitAgent[], seen: Set<string>) => {
    for (const k of kidsOf.get(a.id) ?? []) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      out.push(k);
      descendants(k, out, seen);
    }
  };

  const visited = new Set<string>();
  const nodeOf = (a: OrbitAgent, depth: number): Node => {
    visited.add(a.id);
    const settled = isSettled(a.lifecycle);
    const base = depth === 0 ? R_PLANET : moonRadius(depth);
    return {
      id: a.id,
      kind: depth === 0 ? "planet" : "moon",
      depth,
      // A failed agent is finished but still needs you: it keeps its size and colour.
      r: settled && a.mood !== "error" ? base * SETTLED_SHRINK : base,
      opacity: settled && a.mood !== "error" ? SETTLED_OPACITY : 1,
      agent: a,
      kids: kidsFor(a.id, depth + 1),
      ringR: 0,
      sys: 0,
    };
  };
  const kidsFor = (parentId: string | null, depth: number): Node[] => {
    const all = (kidsOf.get(parentId) ?? []).filter((k) => !visited.has(k.id));
    if (parentId === null || all.length <= SWARM_OVER) return all.map((k) => nodeOf(k, depth));
    const ranked = [...all].sort(
      (a, b) =>
        urgencyOf(a) - urgencyOf(b) ||
        (urgency(a) === 4
          ? (b.endedAt ?? 0) - (a.endedAt ?? 0)
          : (b.spawnedAt ?? 0) - (a.spawnedAt ?? 0)) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const keep = new Set(ranked.slice(0, SWARM_KEEP).map((a) => a.id));
    const kept = all.filter((k) => keep.has(k.id)).map((k) => nodeOf(k, depth));
    const members = all.filter((k) => !keep.has(k.id));
    const hidden: OrbitAgent[] = [...members];
    const seen = new Set(hidden.map((m) => m.id));
    for (const m of members) descendants(m, hidden, seen);
    for (const h of hidden) visited.add(h.id);
    const allSettled = members.every((m) => isSettled(m.lifecycle));
    kept.push({
      id: swarmId(parentId),
      kind: "swarm",
      depth,
      r: moonRadius(depth),
      opacity: allSettled ? 0.6 : 1,
      members,
      memberIds: hidden.map((h) => h.id),
      kids: [],
      ringR: 0,
      sys: 0,
    });
    return kept;
  };

  return {
    id: SUN_ID,
    kind: "sun",
    depth: -1,
    r: R_SUN,
    opacity: 1,
    kids: kidsFor(null, 0),
    ringR: 0,
    sys: 0,
  };
}

/** System radius (the body plus everything circling it), in natural px. */
function measure(n: Node): number {
  if (n.kids.length === 0) {
    n.sys = n.r;
    return n.sys;
  }
  let child = 0;
  for (const k of n.kids) child = Math.max(child, measure(k));
  const ring = ringOrder(n.kids);
  const m = ring.length;
  // Clear of the parent, and each pair of neighbours' systems clear of each other.
  let r = n.r + child + GAP;
  if (m >= 2) {
    const chord = 2 * Math.sin(Math.PI / m);
    ring.forEach((k, i) => {
      const next = ring[(i + 1) % m] ?? k;
      r = Math.max(r, (k.sys + next.sys + GAP) / chord);
    });
  }
  n.ringR = r;
  n.sys = Math.max(n.r, r + child);
  return n.sys;
}

/** Siblings in ring order: by each id's own angle, so the order never depends on input order. */
function ringOrder<T extends { id: string }>(kids: readonly T[]): T[] {
  return kids
    .map((k) => ({ k, a: preferredAngle(k.id) }))
    .sort((p, q) => p.a - q.a || (p.k.id < q.k.id ? -1 : 1))
    .map((p) => p.k);
}

/** Evenly spaced slots, rotated to sit as close as possible to each id's own angle. */
function slotAngles(kids: readonly Node[]): Map<string, number> {
  const sorted = ringOrder(kids);
  const m = sorted.length;
  let sx = 0;
  let sy = 0;
  sorted.forEach((k, i) => {
    const d = preferredAngle(k.id) - (TAU * i) / m;
    sx += Math.cos(d);
    sy += Math.sin(d);
  });
  const offset = sx === 0 && sy === 0 ? 0 : Math.atan2(sy, sx);
  return new Map(sorted.map((k, i) => [k.id, offset + (TAU * i) / m]));
}

const drift = (depth: number, t: number) =>
  (TAU * t) / (PERIOD[Math.min(depth, PERIOD.length - 1)] ?? PERIOD[0]);

/**
 * Where the sun sits and how far things spread. Several planets share a full ring around
 * the sun. One planet (the common case: a lone main agent) would leave most of a full
 * circle empty, so it is pinned to the sun's right and the pair is fitted by its real
 * extent: the sun towards the left, the planet's system filling the rest.
 */
function frameUp(sun: Node, width: number, height: number) {
  const solo = sun.kids.length === 1 ? sun.kids[0] : undefined;
  if (!solo) {
    const fit = Math.max(0.05, (Math.min(width, height) / 2 - MARGIN) / sun.sys);
    return {
      solo: false,
      cx: width / 2,
      cy: height / 2,
      spread: Math.min(fit, MAX_SPREAD),
      grow: Math.min(fit, MAX_GROW),
    };
  }
  const boxW = sun.r + sun.ringR + solo.sys;
  const boxH = 2 * Math.max(sun.r, solo.sys);
  const fit = Math.max(0.05, Math.min((width - 2 * MARGIN) / boxW, (height - 2 * MARGIN) / boxH));
  const grow = Math.min(fit, SOLO_GROW);
  const spread = Math.min(fit, grow * SOLO_SPREAD);
  // Centre the whole pair, then keep the sun within the left third when there's room.
  const left = MARGIN + (width - 2 * MARGIN - boxW * spread) / 2;
  const cx = Math.max(MARGIN + sun.r * spread, Math.min(left + sun.r * spread, width / 3));
  return { solo: true, cx, cy: height / 2, spread, grow };
}

/** Lays the orbit out in `frame` at time `t` (ms). Same inputs, same layout. */
export function layoutOrbit(input: OrbitInput, frame: OrbitFrame, t: number): OrbitLayout {
  const width = Math.max(1, frame.width);
  const height = Math.max(1, frame.height);
  const sun = buildTree(input);
  measure(sun);
  const { solo, cx, cy, spread, grow } = frameUp(sun, width, height);

  const bodies: OrbitBody[] = [];
  const rings: OrbitRing[] = [];
  const initial =
    input.project.initial ?? (input.project.name.trim()[0] ?? "?").toLocaleUpperCase();

  const place = (
    n: Node,
    x: number,
    y: number,
    angle: number,
    orbitRadius: number,
    around: string | null,
  ) => {
    bodies.push({
      id: n.id,
      kind: n.kind,
      x,
      y,
      r: n.r * grow,
      parentId: n.kind === "moon" || n.kind === "swarm" ? around : null,
      around,
      angle,
      orbitRadius,
      depth: n.depth,
      opacity: n.opacity,
      ...(n.agent ? { agent: n.agent } : {}),
      ...(n.kind === "swarm"
        ? { count: n.memberIds?.length ?? 0, memberIds: n.memberIds, members: n.members }
        : {}),
      ...(n.kind === "sun" ? { label: initial } : {}),
    });
    if (n.kids.length === 0) return;
    const ringR = n.ringR * spread;
    rings.push({ around: n.id, cx: x, cy: y, r: ringR, depth: n.depth + 1 });
    // A lone planet stays put to the sun's right; moons always drift.
    const pinned = solo && n.kind === "sun";
    const slots = pinned ? null : slotAngles(n.kids);
    const turn = pinned ? 0 : drift(n.depth + 1, t);
    for (const k of n.kids) {
      const a = (slots?.get(k.id) ?? 0) + turn;
      place(k, x + ringR * Math.cos(a), y + ringR * Math.sin(a), a, ringR, n.id);
    }
  };
  place(sun, cx, cy, 0, 0, null);

  return { width, height, scale: grow, bodies, rings };
}
