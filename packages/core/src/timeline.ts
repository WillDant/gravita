import type { GravitaEvent, ToolKind } from "@gravita/protocol";
import { MAIN_AGENT } from "@gravita/protocol/ids";

// The line map: a schematic (not to scale) transit diagram of one session.
// Each agent is a line; tool calls are stations placed on a shared column axis in
// time order; a subagent branches off its parent at the spawning station and merges
// back where it completed. Pure and deterministic, so it's cheap to recompute.

export type StationStatus = "running" | "ok" | "error" | "waiting";

export interface Station {
  id: string;
  agentId: string;
  col: number;
  kind: ToolKind;
  name: string;
  /** Short target: file name, command, query or agent type. */
  label: string;
  /** Consecutive calls of the same tool collapse into one station. */
  count: number;
  toolUseIds: string[];
  status: StationStatus;
  startTs: string;
  /** For Agent/Task stations: the subagent it started. */
  spawnsAgentId?: string;
}

export interface Line {
  agentId: string;
  parentId: string | null;
  depth: number;
  agentType: string;
  description?: string;
  background: boolean;
  lane: number;
  /** Column where the line branches off its parent (main starts at 0). */
  startCol: number;
  /** Column where the line merged back; undefined while it's still running. */
  endCol?: number;
  ended: boolean;
  stations: Station[];
}

export interface LineMap {
  lines: Line[];
  /** Number of columns used; the "now" rule sits at this column. */
  cols: number;
  lanes: number;
}

function shortLabel(e: Extract<GravitaEvent, { type: "tool.started" }>): string {
  const t = e.data.target;
  const file = t.path?.split(/[\\/]/).filter(Boolean).at(-1);
  const raw = t.agentType ?? file ?? t.cmd ?? t.query ?? t.url ?? e.data.name;
  return raw.length > 32 ? `${raw.slice(0, 31)}…` : raw;
}

/** Stable time order: by timestamp, then by original position. Events without ts are skipped. */
function chronological(events: GravitaEvent[]): GravitaEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.ts)
    .sort((a, b) => (a.e.ts < b.e.ts ? -1 : a.e.ts > b.e.ts ? 1 : a.i - b.i))
    .map(({ e }) => e);
}

export function buildLineMap(events: GravitaEvent[]): LineMap {
  const seen = new Set<string>();
  const unique = events.filter((e) => {
    if (seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  });

  const lines = new Map<string, Line>();
  const line = (agentId: string): Line => {
    let l = lines.get(agentId);
    if (!l) {
      l = {
        agentId,
        parentId: agentId === MAIN_AGENT ? null : MAIN_AGENT,
        depth: agentId === MAIN_AGENT ? 0 : 1,
        agentType: agentId === MAIN_AGENT ? "main" : "general-purpose",
        background: false,
        lane: 0,
        startCol: 0,
        ended: false,
        stations: [],
      };
      lines.set(agentId, l);
    }
    return l;
  };
  line(MAIN_AGENT);

  // Spawn metadata first, so stations know which child an Agent call started.
  const childBySpawnTool = new Map<string, string>();
  for (const e of unique) {
    if (e.type !== "agent.spawned" || !e.agentId) continue;
    const l = line(e.agentId);
    l.parentId = e.data.parentAgentId;
    l.agentType = e.data.agentType;
    if (e.data.description) l.description = e.data.description;
    l.background = e.data.background;
    if (e.data.spawnToolUseId) childBySpawnTool.set(e.data.spawnToolUseId, e.agentId);
  }

  const stationByTool = new Map<string, Station>();
  const doneTools = new Set<string>();
  const spawnColByChild = new Map<string, number>();
  let col = 0;

  for (const e of chronological(unique)) {
    const agentId = e.agentId ?? MAIN_AGENT;
    switch (e.type) {
      case "tool.started": {
        const l = line(agentId);
        const prev = l.stations.at(-1);
        const spawns = childBySpawnTool.get(e.data.toolUseId);
        const canCollapse =
          prev &&
          !spawns &&
          !prev.spawnsAgentId &&
          prev.name === e.data.name &&
          prev.status !== "waiting";
        if (canCollapse) {
          prev.count++;
          prev.toolUseIds.push(e.data.toolUseId);
          prev.status = "running";
          prev.label = shortLabel(e);
          stationByTool.set(e.data.toolUseId, prev);
          break;
        }
        col++;
        const s: Station = {
          id: e.data.toolUseId,
          agentId,
          col,
          kind: e.data.kind,
          name: e.data.name,
          label: shortLabel(e),
          count: 1,
          toolUseIds: [e.data.toolUseId],
          status: "running",
          startTs: e.ts,
          ...(spawns ? { spawnsAgentId: spawns } : {}),
        };
        if (spawns) spawnColByChild.set(spawns, col);
        l.stations.push(s);
        stationByTool.set(e.data.toolUseId, s);
        break;
      }
      case "tool.completed": {
        const s = stationByTool.get(e.data.toolUseId);
        if (!s) break;
        if (!e.data.ok) s.status = "error";
        else if (s.status !== "error") {
          const allDone = s.toolUseIds.every((id) => id === e.data.toolUseId || doneTools.has(id));
          s.status = allDone ? "ok" : "running";
        }
        doneTools.add(e.data.toolUseId);
        break;
      }
      case "permission.requested": {
        const l = line(agentId);
        const s = (e.data.toolUseId && stationByTool.get(e.data.toolUseId)) || l.stations.at(-1);
        if (s) s.status = "waiting";
        break;
      }
      case "permission.resolved": {
        for (const s of line(agentId).stations) if (s.status === "waiting") s.status = "running";
        break;
      }
      case "agent.completed": {
        const l = line(agentId);
        if (!l.ended) {
          col++;
          l.ended = true;
          l.endCol = col;
        }
        break;
      }
      case "agent.spawned": {
        if (!spawnColByChild.has(agentId)) {
          // Spawned without a visible Agent call (e.g. call not recorded): branch at "now".
          col++;
          spawnColByChild.set(agentId, col);
        }
        break;
      }
    }
  }

  for (const l of lines.values()) {
    if (l.agentId === MAIN_AGENT) continue;
    l.startCol = spawnColByChild.get(l.agentId) ?? l.stations[0]?.col ?? 0;
    const parent = l.parentId ? lines.get(l.parentId) : undefined;
    l.depth = parent ? computeDepth(lines, l) : 1;
  }

  assignLanes(lines);
  const all = [...lines.values()].sort((a, b) => a.lane - b.lane || a.startCol - b.startCol);
  return { lines: all, cols: col + 1, lanes: Math.max(0, ...all.map((l) => l.lane)) + 1 };
}

function computeDepth(lines: Map<string, Line>, l: Line): number {
  let depth = 0;
  let cur: Line | undefined = l;
  const guard = new Set<string>();
  while (cur?.parentId && !guard.has(cur.agentId)) {
    guard.add(cur.agentId);
    depth++;
    cur = lines.get(cur.parentId);
  }
  return depth;
}

/**
 * Greedy interval packing, depth-first: each line takes the first lane below its
 * parent whose occupied column ranges don't overlap its own, so sequential subagents
 * reuse a lane like a branch line serving several trips.
 */
function assignLanes(lines: Map<string, Line>) {
  const children = new Map<string, Line[]>();
  for (const l of lines.values()) {
    if (!l.parentId) continue;
    const list = children.get(l.parentId) ?? [];
    list.push(l);
    children.set(l.parentId, list);
  }
  for (const list of children.values())
    list.sort((a, b) => a.startCol - b.startCol || a.agentId.localeCompare(b.agentId));

  const occupied: { start: number; end: number }[][] = [];
  const fits = (lane: number, start: number, end: number) =>
    (occupied[lane] ?? []).every((r) => end < r.start || start > r.end);
  const occupy = (lane: number, start: number, end: number) => {
    occupied[lane] = occupied[lane] ?? [];
    occupied[lane]!.push({ start, end });
  };

  const main = lines.get(MAIN_AGENT)!;
  main.lane = 0;
  occupy(0, 0, Number.POSITIVE_INFINITY);

  const visit = (parent: Line) => {
    for (const child of children.get(parent.agentId) ?? []) {
      const end = child.endCol ?? Number.POSITIVE_INFINITY;
      let lane = parent.lane + 1;
      while (!fits(lane, child.startCol, end)) lane++;
      child.lane = lane;
      occupy(lane, child.startCol, end);
      visit(child);
    }
  };
  visit(main);
}
