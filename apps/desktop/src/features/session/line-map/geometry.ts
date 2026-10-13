import type { Lifecycle, Line, LineMap, Station } from "@gravita/core";
import { TERMINAL } from "@gravita/core";
import { lineCode } from "@gravita/orbs";

// Pure layout of the line map: from the timeline (lines, stations, columns) and the
// frame size to positioned primitives. No React, no i18n, no DOM. Render components
// draw exactly what this returns.

export const COL_MAX = 96;
export const COL_MIN = 16;
export const LANE_MIN = 56;
export const LANE_MAX = 104;
export const PAD_L = 28;
export const PAD_T = 44;
export const PAD_B = 36;
/** 45° chamfer where a branch leaves or rejoins its parent, as on a metro diagram. */
export const K = 12;
export const LINE_W = 5;
export const ORB = 30;
/** Rough width of one character of the 12px label face, for truncation. */
export const CHAR_W = 6.6;
/** Opacity of lines that aren't the selected agent's. */
export const DIM = 0.6;

/** What the map needs to know about each agent that has a node in the session. */
export interface AgentInfo {
  /** Lifecycle as the UI shows it now (effectiveLifecycle). */
  lifecycle: Lifecycle;
  /** Plain-language persona label, already translated ("Reading app.ts"). */
  label: string;
  /** Tool of the first pending permission request, when held. */
  askTool?: string;
}

export interface LayoutOptions {
  /** The session is live or recently live: lines run to the "now" rule. */
  live: boolean;
  /** Agents by id; lines without an entry have no node (drawn as finished). */
  agents: Readonly<Record<string, AgentInfo>>;
  selectedAgentId?: string;
  /**
   * Translated words the map prints; `type` names a subagent line by its type (a Codex
   * role reads as a word in the user's language), else the type shows as it is.
   */
  texts: { main: string; hold: string; type?: (agentType: string) => string };
}

export interface Frame {
  w: number;
  h: number;
}

export interface PathPrimitive {
  agentId: string;
  agentType: string;
  d: string;
  /** Dotted, for a detached agent. */
  detached: boolean;
  dimmed: boolean;
}

export interface InterchangePrimitive {
  key: string;
  agentType: string;
  /** Where the branch leaves its parent, or where it merges back. */
  kind: "spawn" | "merge";
  /** Centre of the pip, on the parent's lane; the capsule hangs below it. */
  cx: number;
  cy: number;
}

/**
 * A white connector joining interchanges of one kind on one parent at consecutive
 * columns (subagents launched in one message, or merging back one after another),
 * like the linked interchange circles of an Underground map. Drawn behind the capsules.
 */
export interface InterchangeLinkPrimitive {
  /** The first capsule's key, so the link keeps its identity as the group grows. */
  key: string;
  /** Pip centres of the first and last capsule. */
  x0: number;
  x1: number;
  cy: number;
}

export interface StationPrimitive {
  station: Station;
  cx: number;
  cy: number;
  /** "×n" under the station (hidden under the signage of a running line's last stop). */
  showCount: boolean;
}

export interface LabelPrimitive {
  agentId: string;
  agentType: string;
  code: string;
  /** Untruncated "name · description", for the tooltip and accessible name. */
  full: string;
  text: string;
  x: number;
  y: number;
  textW: number;
}

export interface SignagePrimitive {
  agentId: string;
  /** Right edge (text is end-anchored). */
  x: number;
  y: number;
  text: string;
  held: boolean;
}

export interface HeadPrimitive {
  agentId: string;
  agentType: string;
  cx: number;
  cy: number;
}

export interface NowRule {
  x: number;
  y1: number;
  y2: number;
  labelY: number;
}

export interface LineMapLayout {
  width: number;
  height: number;
  colW: number;
  laneH: number;
  x: (col: number) => number;
  y: (lane: number) => number;
  now?: NowRule;
  paths: PathPrimitive[];
  interchanges: InterchangePrimitive[];
  links: InterchangeLinkPrimitive[];
  stations: StationPrimitive[];
  signage: SignagePrimitive[];
  labels: LabelPrimitive[];
  heads: HeadPrimitive[];
}

/** Shortens `text` with an ellipsis to fit `maxPx` at the label face's width. */
export function fitText(text: string, maxPx: number): string {
  // The epsilon absorbs float error when a slid label gets exactly its own width.
  const max = Math.max(4, Math.floor(maxPx / CHAR_W + 1e-6));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

type X = (col: number) => number;
type Y = (lane: number) => number;

/** Octolinear route: vertical drop, 45° knee, horizontal run (and the mirror to merge). */
export function linePath(
  x: X,
  y: Y,
  l: Line,
  lines: ReadonlyMap<string, Line>,
  nowCol: number | undefined,
): string {
  const yl = y(l.lane);
  const lastCol = l.stations.at(-1)?.col ?? l.startCol;
  const runningEnd = nowCol ?? lastCol + 0.8;
  if (!l.parentId) {
    return `M ${x(0)} ${yl} H ${x(Math.max(runningEnd, lastCol, 0.5))}`;
  }
  const parent = lines.get(l.parentId);
  const yp = parent ? y(parent.lane) : y(0);
  const xs = x(l.startCol);
  let d = `M ${xs} ${yp} V ${yl - K} L ${xs + K} ${yl}`;
  if (l.ended && l.endCol !== undefined) {
    const xe = x(l.endCol);
    d += ` H ${Math.max(xe - K, xs + K)} L ${xe} ${yl - K} V ${yp}`;
  } else {
    d += ` H ${Math.max(x(runningEnd), xs + K)}`;
  }
  return d;
}

function label(
  line: Line,
  x: X,
  y: Y,
  maxRight: number,
  texts: LayoutOptions["texts"],
): LabelPrimitive {
  const isMain = !line.parentId;
  const name = isMain ? texts.main : (texts.type?.(line.agentType) ?? line.agentType);
  const detail = !isMain && line.description ? ` · ${line.description}` : "";
  const full = `${name}${detail}`;
  // Start just past the spawn leg; the knockout lets the name run over any line it
  // crosses. Slide left when it would hit the frame, shorten only when nothing fits.
  const minLeft = isMain ? PAD_L - 8 : x(line.startCol) + K + 6;
  const lx = Math.max(PAD_L - 8, Math.min(minLeft + 4, maxRight - 21 - full.length * CHAR_W));
  const text = fitText(full, maxRight - (lx + 21));
  return {
    agentId: line.agentId,
    agentType: line.agentType,
    code: lineCode(line.agentType),
    full,
    text,
    x: lx,
    y: y(line.lane) - 17,
    textW: text.length * CHAR_W,
  };
}

/**
 * Groups interchanges of the same kind on the same parent at consecutive columns and
 * returns one connector per group of two or more. A spawn next to a merge stays apart:
 * they are different events that only happen to be neighbours.
 */
function linkInterchanges(
  stops: { parentId: string; kind: "spawn" | "merge"; col: number; i: number }[],
  items: readonly InterchangePrimitive[],
): InterchangeLinkPrimitive[] {
  const sorted = [...stops].sort(
    (a, b) => a.parentId.localeCompare(b.parentId) || a.kind.localeCompare(b.kind) || a.col - b.col,
  );
  const links: InterchangeLinkPrimitive[] = [];
  let group: typeof sorted = [];
  const close = () => {
    if (group.length < 2) return;
    const first = items[group[0]!.i]!;
    const last = items[group.at(-1)!.i]!;
    links.push({ key: first.key, x0: first.cx, x1: last.cx, cy: first.cy });
  };
  for (const s of sorted) {
    const prev = group.at(-1);
    if (prev && (prev.parentId !== s.parentId || prev.kind !== s.kind || s.col - prev.col !== 1)) {
      close();
      group = [];
    }
    group.push(s);
  }
  close();
  return links;
}

/** Fits the map to its frame like a printed diagram; it scrolls only when it can't fit. */
export function layoutLineMap(map: LineMap, frame: Frame, opts: LayoutOptions): LineMapLayout {
  const { live, agents, selectedAgentId, texts } = opts;
  const lineById = new Map(map.lines.map((l) => [l.agentId, l]));
  const nowCol = map.cols;
  const colW = frame.w
    ? Math.max(COL_MIN, Math.min(COL_MAX, (frame.w - PAD_L - ORB - 64) / Math.max(nowCol, 1)))
    : COL_MAX;
  const laneH = frame.h
    ? Math.max(LANE_MIN, Math.min(LANE_MAX, (frame.h - PAD_T - PAD_B) / Math.max(map.lanes, 1)))
    : LANE_MIN;
  // Spare height lifts the diagram off the top edge instead of leaving it pinned there.
  const spare = frame.h ? Math.max(0, frame.h - PAD_T - PAD_B - laneH * map.lanes) : 0;
  const top = PAD_T + spare * 0.3;
  const x: X = (col) => PAD_L + col * colW;
  const y: Y = (lane) => top + lane * laneH;
  /** Centre of the orb riding at the head of a running line. */
  const headX = (l: Line) =>
    live ? x(nowCol) + ORB / 2 + 4 : x((l.stations.at(-1)?.col ?? l.startCol) + 0.8);
  const width = Math.max(x(nowCol) + ORB + 48, frame.w);
  const height = Math.max(y(map.lanes - 1) + PAD_B + 12, frame.h);

  const paths: PathPrimitive[] = map.lines.map((l) => ({
    agentId: l.agentId,
    agentType: l.agentType,
    d: linePath(x, y, l, lineById, live ? nowCol : undefined),
    detached: (agents[l.agentId]?.lifecycle ?? "done") === "detached",
    dimmed: Boolean(selectedAgentId) && selectedAgentId !== l.agentId,
  }));

  // Interchanges: where a branch leaves its parent and where it merges back.
  const interchanges: InterchangePrimitive[] = [];
  const stops: { parentId: string; kind: "spawn" | "merge"; col: number; i: number }[] = [];
  const stop = (l: Line, parent: Line, kind: "spawn" | "merge", col: number) => {
    stops.push({ parentId: parent.agentId, kind, col, i: interchanges.length });
    interchanges.push({
      key: `${l.agentId}:${kind === "spawn" ? "start" : "end"}`,
      agentType: l.agentType,
      kind,
      cx: x(col),
      cy: y(parent.lane),
    });
  };
  for (const l of map.lines) {
    const parent = l.parentId ? lineById.get(l.parentId) : undefined;
    if (!parent) continue;
    stop(l, parent, "spawn", l.startCol);
    if (l.ended && l.endCol !== undefined) stop(l, parent, "merge", l.endCol);
  }
  const links = linkInterchanges(stops, interchanges);

  const stations: StationPrimitive[] = map.lines.flatMap((l) => {
    const signed = !l.ended ? l.stations.at(-1)?.id : undefined;
    return l.stations
      .filter((s) => !s.spawnsAgentId)
      .map((s) => ({ station: s, cx: x(s.col), cy: y(l.lane), showCount: s.id !== signed }));
  });

  // Signage at the head of each running line: where that agent is right now.
  const signage: SignagePrimitive[] = [];
  for (const l of map.lines) {
    const info = agents[l.agentId];
    if (!info || l.ended) continue;
    if (info.lifecycle !== "active" && info.lifecycle !== "waiting_user") continue;
    const held = info.lifecycle === "waiting_user";
    const text = held ? `${texts.hold}${info.askTool ? ` · ${info.askTool}` : ""}` : info.label;
    const right = headX(l) + ORB / 2;
    signage.push({
      agentId: l.agentId,
      x: right,
      y: y(l.lane) + ORB / 2 + 14,
      text: fitText(text, Math.min(260, right - PAD_L)),
      held,
    });
  }

  // A running line's name must stop short of the orb riding at its head.
  const labels = map.lines.map((l) =>
    label(l, x, y, l.ended ? width - 8 : headX(l) - ORB / 2 - 8, texts),
  );

  const heads: HeadPrimitive[] = [];
  for (const l of map.lines) {
    const info = agents[l.agentId];
    if (!info || l.ended || TERMINAL.has(info.lifecycle)) continue;
    heads.push({ agentId: l.agentId, agentType: l.agentType, cx: headX(l), cy: y(l.lane) });
  }

  return {
    width,
    height,
    colW,
    laneH,
    x,
    y,
    ...(live ? { now: { x: x(nowCol), y1: 22, y2: height - 8, labelY: 14 } } : {}),
    paths,
    interchanges,
    links,
    stations,
    signage,
    labels,
    heads,
  };
}
