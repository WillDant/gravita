import type { MergeState } from "@gravita/core";
import type { TaskStatus } from "@gravita/protocol";
import { CHAR_W, fitText, K, ORB } from "@/features/session/line-map/geometry";

// Pure layout of the squad map: integration is the trunk across the top, each role a
// line in its own lane below it, each task a station on its role's line (one column per
// task, in plan order), each merge a spur rising back into the trunk to an interchange
// capsule. No React, no i18n, no DOM: render components draw exactly what this returns.

export const GUTTER = 136;
export const PAD_T = 52;
export const PAD_B = 44;
export const PAD_R = 40;
export const COL_MIN = 18;
export const COL_MAX = 120;
export const LANE_MIN = 58;
export const LANE_MAX = 104;
/** The planner's orb at the trunk's origin. */
export const PLANNER_ORB = 26;
/** Station titles wrap onto at most two lines of this width (11px signage). */
export const LABEL_MAX_W = 120;
export const LABEL_MIN_W = 72;
/** Rough width of one character of the 11px signage face. */
export const SIGN_CHAR_W = 6.6;
/** Air between two titles on the same row, so they never read as one string. */
export const TITLE_GAP = 12;
const LABEL_LINE_H = 13;
/** Room after the last task for the Verify stretch, then the Deliver terminus. */
const VERIFY_W = 72;
const DELIVER_W = 44;

// Where a task's spawn, station and merge sit inside its column, so the vertical legs
// of one role's spawn and another's merge never share an x.
const AT_SPAWN = 0.2;
const AT_STATION = 0.5;
const AT_MERGE = 0.8;

/** Statuses that mean work on the task has begun (the line is built up to it). */
const STARTED: ReadonlySet<TaskStatus> = new Set([
  "running",
  "review",
  "done",
  "failed",
  "blocked",
  "skipped",
]);
const SETTLED: ReadonlySet<TaskStatus> = new Set(["done", "skipped"]);
const STUCK: ReadonlySet<TaskStatus> = new Set(["blocked", "failed"]);

export interface MapRole {
  id: string;
  /** The colour slot (role kind, or id for custom roles). */
  colorKey: string;
  name: string;
  code: string;
}

export interface MapTask {
  id: string;
  /** The role doing it now. */
  role: string;
  title: string;
  status: TaskStatus;
  foundation: boolean;
  /** The latest merge attempt's state, once a merge started. */
  merge?: MergeState;
}

export interface MapHead {
  /** Plain-language label of the role's current agent ("is editing app.ts"). */
  label: string;
  /** The role's session waits for the user (a permission or a question). */
  held: boolean;
  askTool?: string;
}

export interface SquadMapInput {
  roles: readonly MapRole[];
  /** In column order. */
  tasks: readonly MapTask[];
  /** Roles whose current session is working or waiting right now. */
  heads: Readonly<Record<string, MapHead>>;
  selectedRoleId?: string;
  selectedTaskId?: string;
  /** The squad reached the end of the line: the trunk is drawn whole, to its terminus. */
  finished?: boolean;
  /** What the planner is doing, for its signage at the origin. */
  plannerLabel?: string;
  texts: {
    trunk: string;
    planner: string;
    foundation: string;
    build: string;
    verify: string;
    deliver: string;
    hold: string;
    failed: string;
    conflicted: string;
    reverted: string;
  };
}

export interface Frame {
  w: number;
  h: number;
}

export interface LinePrimitive {
  /** Role id, or "integration" for the trunk. */
  id: string;
  colorKey: string;
  /** What has been built; empty while nothing has started. */
  built: string;
  /** The route still ahead, drawn faint. */
  planned: string;
  dimmed: boolean;
}

export interface SpurPrimitive {
  taskId: string;
  roleId: string;
  colorKey: string;
  d: string;
  state: MergeState;
  dimmed: boolean;
}

export interface CapsulePrimitive {
  key: string;
  /** The task merged here, or undefined for a role's spawn. */
  taskId?: string;
  roleId: string;
  colorKey: string;
  kind: "spawn" | "merge";
  state?: MergeState;
  cx: number;
  cy: number;
}

export interface StationPrimitive {
  taskId: string;
  roleId: string;
  status: TaskStatus;
  cx: number;
  cy: number;
  selected: boolean;
  /** The task's title, wrapped onto one or two lines, under the station or above it. */
  label: { lines: string[]; x: number; y: number; above: boolean };
}

export interface HeadPrimitive {
  roleId: string;
  colorKey: string;
  cx: number;
  cy: number;
}

export interface SignagePrimitive {
  key: string;
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
  text: string;
  /** Waits on the user (orange). */
  held: boolean;
  /** Went wrong (red). */
  error?: boolean;
}

export interface LabelPrimitive {
  id: string;
  colorKey: string;
  code: string;
  text: string;
  full: string;
  x: number;
  y: number;
  textW: number;
  /** The trunk's label sits on the line like a metro name; roles' sit in the gutter. */
  trunk: boolean;
}

export interface ZonePrimitive {
  /** Dotted rules where one phase of the line hands over to the next. */
  rules: number[];
  /** Phase names along the top, each starting just past its rule. */
  labels: { text: string; x: number }[];
  y1: number;
  y2: number;
  labelY: number;
}

export interface SquadMapLayout {
  width: number;
  height: number;
  colW: number;
  laneH: number;
  trunk: LinePrimitive;
  terminus: { x: number; y: number };
  origin: { cx: number; cy: number };
  lines: LinePrimitive[];
  spurs: SpurPrimitive[];
  capsules: CapsulePrimitive[];
  stations: StationPrimitive[];
  heads: HeadPrimitive[];
  signage: SignagePrimitive[];
  labels: LabelPrimitive[];
  zone: ZonePrimitive;
}

/** Word-wraps a title onto at most two lines of `maxPx`; only a third line is cut. */
export function wrapTitle(text: string, maxPx: number): string[] {
  const max = Math.max(4, Math.floor(maxPx / SIGN_CHAR_W));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= max || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  const out = lines.slice(0, 2).map((l) => (l.length > max ? `${l.slice(0, max - 1)}…` : l));
  if (lines.length > 2) {
    const last = `${out[1]} ${lines.slice(2).join(" ")}`;
    out[1] = `${last.slice(0, max - 1)}…`;
  }
  return out;
}

/** Fits the squad's map to its frame; it scrolls sideways only when it can't fit. */
export function layoutSquadMap(input: SquadMapInput, frame: Frame): SquadMapLayout {
  const { roles, tasks, heads, selectedRoleId, selectedTaskId, texts } = input;
  const n = Math.max(tasks.length, 1);
  const x0 = GUTTER + 12;
  const avail = frame.w ? frame.w - x0 - PAD_R - VERIFY_W - DELIVER_W : 0;
  const colW = avail > 0 ? Math.max(COL_MIN, Math.min(COL_MAX, avail / n)) : COL_MAX;
  const lanes = roles.length + 1;
  const room = frame.h ? frame.h - PAD_T - PAD_B : 0;
  const laneH = room > 0 ? Math.max(LANE_MIN, Math.min(LANE_MAX, room / lanes)) : LANE_MIN;
  const spare = frame.h ? Math.max(0, room - laneH * (lanes - 1) - 20) : 0;
  const top = PAD_T + spare * 0.3;
  const kn = Math.min(K, colW * 0.3);

  const colX = (col: number, at: number) => x0 + (col + at) * colW;
  const laneY = (lane: number) => top + lane * laneH;
  const yT = laneY(0);
  const roleLane = new Map(roles.map((r, i) => [r.id, i + 1]));
  const colorOf = new Map(roles.map((r) => [r.id, r.colorKey]));
  const dim = (roleId: string) => Boolean(selectedRoleId) && selectedRoleId !== roleId;

  const buildEnd = colX(n, 0) + 6;
  const verifyEnd = buildEnd + VERIFY_W;
  const endX = verifyEnd + DELIVER_W - 8;
  const width = Math.max(endX + PAD_R + ORB, frame.w);
  const height = Math.max(laneY(lanes - 1) + PAD_B + 16, frame.h);

  // Stations, and where each role's line has got to.
  const stations: StationPrimitive[] = [];
  const spurs: SpurPrimitive[] = [];
  const capsules: CapsulePrimitive[] = [];
  const perRole = new Map<
    string,
    { first?: number; last?: number; built?: number; settled: boolean; lastMerge?: number }
  >();
  for (const r of roles) perRole.set(r.id, { settled: true });
  let mergedTo: number | undefined;

  tasks.forEach((task, col) => {
    const lane = roleLane.get(task.role);
    const info = perRole.get(task.role);
    if (lane === undefined || !info) return;
    const cy = laneY(lane);
    const cx = colX(col, AT_STATION);
    info.first ??= col;
    info.last = col;
    if (STARTED.has(task.status)) info.built = col;
    if (!SETTLED.has(task.status)) info.settled = false;
    stations.push({
      taskId: task.id,
      roleId: task.role,
      status: task.status,
      cx,
      cy,
      selected: selectedTaskId === task.id,
      label: { lines: [], x: cx, y: cy + 20, above: false },
    });
    if (task.merge) {
      const mx = colX(col, AT_MERGE);
      const colorKey = colorOf.get(task.role) ?? task.role;
      spurs.push({
        taskId: task.id,
        roleId: task.role,
        colorKey,
        d: `M ${mx - kn} ${cy} L ${mx} ${cy - kn} V ${yT}`,
        state: task.merge,
        dimmed: dim(task.role),
      });
      capsules.push({
        key: `m:${task.id}`,
        taskId: task.id,
        roleId: task.role,
        colorKey,
        kind: "merge",
        state: task.merge,
        cx: mx,
        cy: yT,
      });
      info.lastMerge = col;
      if (task.merge === "succeeded") mergedTo = Math.max(mergedTo ?? 0, mx);
    }
  });

  // Each role leaves the trunk before its first task, drops on a 45° knee into its lane
  // and runs right; built as far as work has started, faint beyond.
  const lines: LinePrimitive[] = [];
  for (const r of roles) {
    const info = perRole.get(r.id);
    const lane = roleLane.get(r.id);
    if (!info || lane === undefined || info.first === undefined || info.last === undefined)
      continue;
    const yl = laneY(lane);
    const sx = colX(info.first, AT_SPAWN);
    const drop = `M ${sx} ${yT} V ${yl - kn} L ${sx + kn} ${yl}`;
    const lastX = colX(info.last, AT_STATION);
    // A finished role runs on to its last merge's spur, which carries it into the trunk.
    const tail =
      info.settled && info.lastMerge === info.last ? colX(info.last, AT_MERGE) - kn : lastX;
    let built = "";
    let planned = "";
    if (info.built === undefined) {
      planned = `${drop} H ${Math.max(lastX, sx + kn)}`;
    } else {
      const bx = info.settled ? tail : Math.max(colX(info.built, AT_STATION), sx + kn);
      built = `${drop} H ${bx}`;
      if (lastX > bx) planned = `M ${bx} ${yl} H ${lastX}`;
    }
    capsules.unshift({
      key: `s:${r.id}`,
      roleId: r.id,
      colorKey: r.colorKey,
      kind: "spawn",
      cx: sx,
      cy: yT,
    });
    lines.push({ id: r.id, colorKey: r.colorKey, built, planned, dimmed: dim(r.id) });
  }

  const originX = x0 - 4;
  const builtTo = input.finished ? endX : (mergedTo ?? colX(0, AT_SPAWN));
  const trunk: LinePrimitive = {
    id: "integration",
    colorKey: "integration",
    built: `M ${originX} ${yT} H ${builtTo}`,
    planned: builtTo < endX ? `M ${builtTo} ${yT} H ${endX}` : "",
    dimmed: false,
  };

  // Orbs ride at the head of each working role, just past its current station.
  const headsOut: HeadPrimitive[] = [];
  const signage: SignagePrimitive[] = [];
  const busy = (t: MapTask) => t.status === "running" || t.status === "review";
  for (const r of roles) {
    const head = heads[r.id];
    const lane = roleLane.get(r.id);
    if (!head || lane === undefined) continue;
    const cols = tasks.map((t, i) => ({ t, i })).filter(({ t }) => t.role === r.id);
    // A stuck station keeps its own ring visible; the orb only rides work in progress.
    const at =
      cols.find(({ t }) => busy(t)) ??
      cols.filter(({ t }) => STARTED.has(t.status) && !STUCK.has(t.status)).at(-1);
    if (!at) continue;
    const cx = colX(at.i, AT_STATION) + ORB / 2 + 3;
    const cy = laneY(lane);
    headsOut.push({ roleId: r.id, colorKey: r.colorKey, cx, cy });
    const right = cx + ORB / 2;
    const text = head.held
      ? `${texts.hold}${head.askTool ? ` · ${head.askTool}` : ""}`
      : head.label;
    signage.push({
      key: `h:${r.id}`,
      x: right,
      y: cy + ORB / 2 + 14,
      anchor: "end",
      text: fitText(text, Math.min(260, right - x0 + 40)),
      held: head.held,
    });
  }
  // A stuck task says so in words, unless an orb's signage already covers its role.
  for (const s of stations) {
    if (!STUCK.has(s.status)) continue;
    if (headsOut.some((h) => h.roleId === s.roleId)) continue;
    const failed = s.status === "failed";
    signage.push({
      key: `b:${s.taskId}`,
      x: s.cx,
      y: s.cy + 26,
      anchor: "middle",
      text: failed ? texts.failed : texts.hold,
      held: !failed,
      ...(failed ? { error: true } : {}),
    });
  }
  // A merge that went wrong is named above the trunk, where its red capsule sits.
  for (const c of capsules) {
    if (c.state !== "conflicted" && c.state !== "reverted") continue;
    signage.push({
      key: `m:${c.key}`,
      x: c.cx,
      y: c.cy - 12,
      anchor: "middle",
      text: c.state === "conflicted" ? texts.conflicted : texts.reverted,
      held: false,
      error: true,
    });
  }
  // The planner at the origin carries its own signage, under the trunk's name.
  signage.push({
    key: "planner",
    x: 12,
    y: yT + 26,
    anchor: "start",
    // Kept inside the gutter: the status goes when it doesn't fit, never half a word.
    text: (() => {
      const full = input.plannerLabel ? `${texts.planner} · ${input.plannerLabel}` : texts.planner;
      return full.length * SIGN_CHAR_W <= GUTTER - 16 ? full : texts.planner;
    })(),
    held: false,
  });

  // Every station carries its title: wrapped onto two lines, under the station, or
  // above it when a neighbour's title or an orb's signage already holds the space below.
  // Boxes a title must keep clear of: signage, the orbs riding the lines, and the
  // vertical legs (spawn drops and merge spurs) that cross the lanes.
  type Box = { x1: number; x2: number; y1: number; y2: number };
  // Signage and orbs are hard: a title never lands on them. Legs are soft: a title
  // keeps off them when it can, and otherwise crosses one on its ground halo.
  const hard: Box[] = [
    ...signage.map((g) => {
      const w = g.text.length * SIGN_CHAR_W;
      const x1 = g.anchor === "end" ? g.x - w : g.anchor === "middle" ? g.x - w / 2 : g.x;
      return { x1: x1 - 6, x2: x1 + w + 6, y1: g.y - 11, y2: g.y + 3 };
    }),
    ...headsOut.map((h) => ({
      x1: h.cx - ORB / 2 - 4,
      x2: h.cx + ORB / 2 + 4,
      y1: h.cy - ORB / 2 - 4,
      y2: h.cy + ORB / 2 + 4,
    })),
  ];
  const legs: Box[] = [
    ...spurs.map((sp) => {
      const [, ys, x = 0] = (sp.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      return { x1: x - 4, x2: x + 4, y1: yT, y2: (ys ?? yT) - kn };
    }),
    ...capsules
      .filter((c) => c.kind === "spawn")
      .map((c) => {
        const lane = roleLane.get(c.roleId) ?? 1;
        return { x1: c.cx - 4, x2: c.cx + 4, y1: yT, y2: laneY(lane) - kn };
      }),
  ];
  const byLane = new Map<number, StationPrimitive[]>();
  for (const st of stations) byLane.set(st.cy, [...(byLane.get(st.cy) ?? []), st]);
  for (const lane of byLane.values()) {
    lane.sort((a, b) => a.cx - b.cx);
    const minGap = lane.reduce(
      (m, st, i) => (i ? Math.min(m, st.cx - (lane[i - 1]?.cx ?? 0)) : m),
      Number.POSITIVE_INFINITY,
    );
    // Alternating sides gives each title twice the gap to its neighbour.
    const w = Math.max(LABEL_MIN_W, Math.min(LABEL_MAX_W, 2 * minGap - 8));
    // Four tiers: under the station, above it, further down past any signage, and one
    // row lower still for a crowded stretch of the lane.
    const ends = {
      below: Number.NEGATIVE_INFINITY,
      above: Number.NEGATIVE_INFINITY,
      under: Number.NEGATIVE_INFINITY,
      far: Number.NEGATIVE_INFINITY,
    };
    for (const st of lane) {
      const task = tasks.find((t) => t.id === st.taskId);
      const title = task?.title ?? st.taskId;
      const span = (tier: keyof typeof ends, lines: number) =>
        tier === "above"
          ? { y1: st.cy - 24 - (lines - 1) * LABEL_LINE_H, y2: st.cy - 8 }
          : tier === "under" || tier === "far"
            ? {
                y1: st.cy + (tier === "far" ? 62 : 36),
                y2: st.cy + (tier === "far" ? 76 : 50) + (lines - 1) * LABEL_LINE_H,
              }
            : { y1: st.cy + 10, y2: st.cy + 24 + (lines - 1) * LABEL_LINE_H };
      // Whether a title wrapped to `width` lands clear of signage, orbs and legs on a tier.
      const clear = (tier: keyof typeof ends, width: number, boxes: Box[]) => {
        const lines = wrapTitle(title, width);
        const { y1, y2 } = span(tier, lines.length);
        const half = (Math.max(...lines.map((l) => l.length)) * SIGN_CHAR_W) / 2 + 2;
        return !boxes.some(
          (o) => o.y2 > y1 && o.y1 < y2 && st.cx + half > o.x1 && st.cx - half < o.x2,
        );
      };
      // Each tier offers the room up to the last title placed on it; a title that
      // doesn't land clear at that width tries again wrapped narrower.
      const placeOn = (tier: keyof typeof ends, boxes: Box[]) => {
        const room = Math.min(w, 2 * (st.cx - ends[tier] - TITLE_GAP));
        // Narrower than the narrowest wrap: the title would crowd its neighbour.
        if (room < LABEL_MIN_W - 16) return 0;
        for (const width of [room, LABEL_MIN_W, LABEL_MIN_W - 16])
          if (width <= room && clear(tier, width, boxes)) return width;
        return 0;
      };
      const tiers = ["below", "above", "under", "far"] as const;
      const choose = (boxes: Box[]) => {
        const rooms = tiers.map((tier) => ({ tier, room: placeOn(tier, boxes) }));
        const fits = rooms.find((r) => r.room >= Math.min(w, LABEL_MIN_W + 24));
        return fits ?? rooms.reduce((m, r) => (r.room > m.room ? r : m));
      };
      const strict = choose([...hard, ...legs]);
      const placed = strict.room > 0 ? strict : choose(hard);
      // Nowhere clear: still keep the gap to the neighbour on the row, on the roomiest tier.
      const best =
        placed.room > 0
          ? placed
          : tiers
              .map((tier) => ({ tier, room: Math.min(w, 2 * (st.cx - ends[tier] - TITLE_GAP)) }))
              .reduce((m, r) => (r.room > m.room ? r : m));
      const lines = wrapTitle(title, Math.max(LABEL_MIN_W - 16, best.room));
      const half = (Math.max(...lines.map((l) => l.length)) * SIGN_CHAR_W) / 2;
      ends[best.tier] = st.cx + half;
      const y =
        best.tier === "above"
          ? st.cy - 13 - (lines.length - 1) * LABEL_LINE_H
          : best.tier === "under"
            ? st.cy + 46
            : best.tier === "far"
              ? st.cy + 72
              : st.cy + 20;
      st.label = { lines, x: st.cx, y, above: best.tier === "above" };
    }
  }

  // Names: roles in the gutter beside their lane, the trunk on its own line.
  const labels: LabelPrimitive[] = roles.map((r) => {
    const y = laneY(roleLane.get(r.id) ?? 1);
    const text = fitText(r.name, GUTTER - 36);
    return {
      id: r.id,
      colorKey: r.colorKey,
      code: r.code,
      text,
      full: r.name,
      x: 12,
      y,
      textW: text.length * CHAR_W,
      trunk: false,
    };
  });
  // The trunk is named once, in the gutter like every other line.
  const trunkText = fitText(texts.trunk, GUTTER - 36 - PLANNER_ORB);
  labels.unshift({
    id: "integration",
    colorKey: "integration",
    code: "I",
    text: trunkText,
    full: texts.trunk,
    x: 12,
    y: yT,
    textW: trunkText.length * CHAR_W,
    trunk: true,
  });

  // Dotted rules where the line changes phase, named along the top like the header's
  // track: foundation, build, then verify and the deliver terminus past the last task.
  const foundation = tasks.findIndex((t) => !t.foundation);
  const rules: number[] = [];
  const zoneLabels: { text: string; x: number }[] = [];
  if (foundation > 0) {
    // A foundation stretch too short to hold its name stays unnamed rather than collide.
    if (colX(foundation, 0) - x0 > texts.foundation.length * SIGN_CHAR_W + 12)
      zoneLabels.push({ text: texts.foundation, x: x0 });
    rules.push(colX(foundation, 0));
    zoneLabels.push({ text: texts.build, x: colX(foundation, 0) + 8 });
  } else {
    zoneLabels.push({ text: texts.build, x: x0 });
  }
  rules.push(buildEnd, verifyEnd);
  zoneLabels.push(
    { text: texts.verify, x: buildEnd + 8 },
    { text: texts.deliver, x: verifyEnd + 8 },
  );
  const zone: ZonePrimitive = { rules, labels: zoneLabels, y1: 22, y2: height - 10, labelY: 14 };

  return {
    width,
    height,
    colW,
    laneH,
    trunk,
    terminus: { x: endX, y: yT },
    origin: { cx: x0 - PLANNER_ORB / 2 - 10, cy: yT },
    lines,
    spurs,
    capsules,
    stations,
    heads: headsOut,
    signage,
    labels,
    zone,
  };
}
