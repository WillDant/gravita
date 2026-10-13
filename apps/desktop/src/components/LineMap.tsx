import {
  type AgentNode,
  buildLineMap,
  effectiveLifecycle,
  type Line,
  type SessionState,
  type Station,
  TERMINAL,
  toPersona,
} from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { agentColor, lineCode } from "@/lib/palette";
import { Orb } from "./Orb";

const COL_MAX = 96;
const COL_MIN = 16;
const LANE_MIN = 56;
const LANE_MAX = 104;
const PAD_L = 28;
const PAD_T = 44;
const PAD_B = 36;
/** 45° chamfer where a branch leaves or rejoins its parent, as on a metro diagram. */
const K = 12;
const LINE_W = 5;
const ORB = 30;
/** Rough width of one character of the 12px label face, for truncation. */
const CHAR_W = 6.6;

type X = (col: number) => number;
type Y = (lane: number) => number;

export function agentName(
  node: Pick<AgentNode, "id" | "agentType"> | Pick<Line, "agentId" | "agentType">,
): string {
  const id = "id" in node ? node.id : node.agentId;
  return id === "main" ? t("agent.main") : node.agentType;
}

function fit(text: string, maxPx: number): string {
  const max = Math.max(4, Math.floor(maxPx / CHAR_W));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface LineMapProps {
  session: SessionState;
  events: GravitaEvent[];
  now: number;
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
}

/** The session as a live transit map: agents are lines, tool calls are stations. */
export function LineMap({ session, events, now, selectedAgentId, onSelectAgent }: LineMapProps) {
  const map = useMemo(() => buildLineMap(events), [events]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const known = useRef<Set<string> | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });

  // Fit the map to its frame like a printed diagram; scroll only when it can't fit.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const lineById = useMemo(() => new Map(map.lines.map((l) => [l.agentId, l])), [map]);
  const live = session.live || now - Date.parse(session.lastEventTs) < 10 * 60_000;
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

  // Lines that appear after the first paint draw themselves in (the signature move).
  const fresh = useMemo(() => {
    if (!known.current) {
      known.current = new Set(map.lines.map((l) => l.agentId));
      return new Set<string>();
    }
    const out = new Set<string>();
    for (const l of map.lines) if (!known.current.has(l.agentId)) out.add(l.agentId);
    return out;
  }, [map]);
  useEffect(() => {
    for (const id of fresh) known.current?.add(id);
  }, [fresh]);

  // Follow "now" like a departures board, unless the user scrolled back in time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run whenever the map grows wider.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollLeft = el.scrollWidth;
  }, [width]);

  const paths = map.lines.map((l) => ({
    line: l,
    d: linePath(x, y, l, lineById, live ? nowCol : undefined),
  }));
  const dimmed = (id: string) => Boolean(selectedAgentId) && selectedAgentId !== id;

  return (
    <div
      ref={scroller}
      className="relative h-full overflow-auto"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 24;
      }}
    >
      <svg
        width={width}
        height={height}
        role="group"
        aria-label={t("count.lines", { count: map.lines.length })}
        className="block select-none"
      >
        {live && (
          <g>
            <line
              x1={x(nowCol)}
              x2={x(nowCol)}
              y1={22}
              y2={height - 8}
              stroke="var(--hairline-strong)"
              strokeDasharray="2 4"
            />
            <text
              x={x(nowCol)}
              y={14}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              className="fill-ink-3"
            >
              {t("session.now")}
            </text>
          </g>
        )}

        {/* White casing first, so crossings read like a transit map. */}
        {paths.map(({ line, d }) => (
          <path
            key={`c-${line.agentId}`}
            d={d}
            fill="none"
            stroke="var(--ground)"
            strokeWidth={LINE_W + 5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {paths.map(({ line, d }) => {
          const node = session.agents[line.agentId];
          const lc = node ? effectiveLifecycle(node, session, now) : "done";
          const color = agentColor(line.agentType);
          const isFresh = fresh.has(line.agentId);
          return (
            <path
              key={`l-${line.agentId}`}
              d={d}
              fill="none"
              stroke={color.line}
              strokeWidth={LINE_W}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={lc === "detached" ? "1 9" : isFresh ? "2000" : undefined}
              className={isFresh ? "line-grow" : undefined}
              style={isFresh ? ({ ["--len" as string]: 2000 } as React.CSSProperties) : undefined}
              opacity={dimmed(line.agentId) ? 0.6 : 1}
              role="button"
              tabIndex={-1}
              aria-label={agentName(line)}
              onClick={() => onSelectAgent(line.agentId)}
              onKeyDown={(e) => e.key === "Enter" && onSelectAgent(line.agentId)}
              cursor="pointer"
            />
          );
        })}

        {/* Interchanges: where a branch leaves its parent and where it merges back. */}
        {map.lines.map((l) => {
          if (!l.parentId) return null;
          const parent = lineById.get(l.parentId);
          if (!parent) return null;
          const color = agentColor(l.agentType).line;
          return (
            <g key={`i-${l.agentId}`}>
              <Interchange cx={x(l.startCol)} cy={y(parent.lane)} pip={color} />
              {l.ended && l.endCol !== undefined && (
                <Interchange cx={x(l.endCol)} cy={y(parent.lane)} pip={color} />
              )}
            </g>
          );
        })}

        {map.lines.flatMap((l) => {
          const signed = !l.ended ? l.stations.at(-1)?.id : undefined;
          return l.stations
            .filter((s) => !s.spawnsAgentId)
            .map((s) => (
              <StationMark
                key={s.id}
                cx={x(s.col)}
                cy={y(l.lane)}
                station={s}
                showCount={s.id !== signed}
              />
            ));
        })}

        {/* Signage at the head of each running line: where that agent is right now. */}
        {map.lines.map((l) => {
          const node = session.agents[l.agentId];
          if (!node || l.ended) return null;
          const lc = effectiveLifecycle(node, session, now);
          if (lc !== "active" && lc !== "waiting_user") return null;
          const held = lc === "waiting_user";
          const persona = toPersona(node, session, now);
          const ask = Object.values(node.permissions ?? {})[0];
          const text = held
            ? `${t("map.hold")}${ask ? ` · ${ask.toolName}` : ""}`
            : t(persona.label.key, persona.label.params);
          const right = headX(l) + ORB / 2;
          return (
            <text
              key={`s-${l.agentId}`}
              x={right}
              y={y(l.lane) + ORB / 2 + 14}
              textAnchor="end"
              fontSize={11}
              fontWeight={held ? 700 : 600}
              className={held ? "fill-waiting-ink" : "fill-ink-2"}
              stroke="var(--ground)"
              strokeWidth={4}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {fit(text, Math.min(260, right - PAD_L))}
            </text>
          );
        })}

        {map.lines.map((l) => (
          <LineLabel
            key={`t-${l.agentId}`}
            x={x}
            y={y}
            line={l}
            // A running line's name must stop short of the orb riding at its head.
            maxRight={l.ended ? width - 8 : headX(l) - ORB / 2 - 8}
            onSelect={onSelectAgent}
          />
        ))}

        {map.lines.map((l) => {
          const node = session.agents[l.agentId];
          if (!node) return null;
          const lc = effectiveLifecycle(node, session, now);
          if (l.ended || TERMINAL.has(lc)) return null;
          const persona = toPersona(node, session, now);
          const cx = headX(l);
          return (
            <g
              key={`o-${l.agentId}`}
              transform={`translate(${cx - ORB / 2}, ${y(l.lane) - ORB / 2})`}
              role="button"
              tabIndex={0}
              aria-label={`${agentName(l)} ${t(persona.label.key, persona.label.params)}`}
              onClick={() => onSelectAgent(l.agentId)}
              onKeyDown={(e) => e.key === "Enter" && onSelectAgent(l.agentId)}
              cursor="pointer"
            >
              <Orb
                color={agentColor(l.agentType)}
                persona={persona}
                size={ORB}
                pop={fresh.has(l.agentId)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Octolinear route: vertical drop, 45° knee, horizontal run (and the mirror to merge). */
function linePath(
  x: X,
  y: Y,
  l: Line,
  lines: Map<string, Line>,
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

function Interchange({ cx, cy, pip }: { cx: number; cy: number; pip: string }) {
  return (
    <g>
      <rect
        x={cx - 6.5}
        y={cy - 6.5}
        width={13}
        height={25}
        rx={6.5}
        fill="var(--station)"
        stroke="var(--ink)"
        strokeWidth={2.2}
      />
      <circle cx={cx} cy={cy} r={2.6} fill={pip} />
    </g>
  );
}

function LineLabel({
  x,
  y,
  line,
  maxRight,
  onSelect,
}: {
  x: X;
  y: Y;
  line: Line;
  maxRight: number;
  onSelect: (id: string) => void;
}) {
  const color = agentColor(line.agentType);
  const isMain = !line.parentId;
  const name = isMain ? t("agent.main") : line.agentType;
  const detail = !isMain && line.description ? ` · ${line.description}` : "";
  const full = `${name}${detail}`;
  // Start just past the spawn leg; the knockout lets the name run over any line it
  // crosses. Slide left when it would hit the frame, shorten only when nothing fits.
  const minLeft = isMain ? PAD_L - 8 : x(line.startCol) + K + 6;
  const lx = Math.max(PAD_L - 8, Math.min(minLeft + 4, maxRight - 21 - full.length * CHAR_W));
  const ly = y(line.lane) - 17;
  const text = fit(full, maxRight - (lx + 21));
  const textW = text.length * CHAR_W;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${name}${detail}`}
      onClick={() => onSelect(line.agentId)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(line.agentId)}
      cursor="pointer"
    >
      <title>{full}</title>
      {/* Knockout, as on printed metro maps: any other line crossing the name is masked. */}
      <rect
        x={lx - 2}
        y={ly - 10}
        width={textW + 27}
        height={20}
        rx={6}
        fill="var(--ground)"
        opacity={0.92}
      />
      <circle cx={lx + 8} cy={ly} r={8} fill={color.badge} />
      <text
        x={lx + 8}
        y={ly + 3.5}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        fill={color.badgeText}
      >
        {lineCode(line.agentType)}
      </text>
      <text
        x={lx + 21}
        y={ly + 4}
        fontSize={12}
        fontWeight={600}
        className="fill-ink"
        stroke="var(--ground)"
        strokeWidth={4}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {text}
      </text>
    </g>
  );
}

function StationMark({
  cx,
  cy,
  station: s,
  showCount,
}: {
  cx: number;
  cy: number;
  station: Station;
  showCount: boolean;
}) {
  const title = `${s.name}${s.label && s.label !== s.name ? ` · ${s.label}` : ""}${s.count > 1 ? ` ×${s.count}` : ""}`;
  if (s.status === "waiting") {
    return (
      <g>
        <title>{title}</title>
        <circle
          cx={cx}
          cy={cy}
          r={9}
          fill="none"
          stroke="var(--waiting)"
          strokeWidth={2}
          className="ring-pulse"
        />
        <circle
          cx={cx}
          cy={cy}
          r={6.5}
          fill="var(--station)"
          stroke="var(--waiting)"
          strokeWidth={2.6}
        />
      </g>
    );
  }
  const error = s.status === "error";
  return (
    <g>
      <title>{title}</title>
      <circle
        cx={cx}
        cy={cy}
        r={4.6}
        fill={s.status === "running" ? "var(--ink)" : "var(--station)"}
        stroke={error ? "var(--error)" : "var(--ink)"}
        strokeWidth={error ? 2.4 : 2}
      />
      {showCount && s.count > 1 && (
        <text
          x={cx}
          y={cy + 18}
          textAnchor="middle"
          fontSize={9.5}
          fontWeight={600}
          className="fill-ink-3 tabular"
        >
          ×{s.count}
        </text>
      )}
    </g>
  );
}
