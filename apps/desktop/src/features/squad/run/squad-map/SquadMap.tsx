import type { SquadState } from "@gravita/core";
import { agentColor } from "@gravita/orbs";
import type { TaskStatus } from "@gravita/protocol";
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Orb } from "@/features/agents/Orb";
import { LINE_W, ORB } from "@/features/session/line-map/geometry";
import { changedAt, useMotionBudget } from "@/features/session/line-map/useMotionBudget";
import { t } from "@/shared/i18n/i18n";
import type { SquadView } from "../../model";
import { RESTING, type SessionHead, sessionHead } from "../../personas";
import {
  type CapsulePrimitive,
  type LabelPrimitive,
  type LinePrimitive,
  layoutSquadMap,
  MARK_W,
  type MapHead,
  PLANNER_ORB,
  type SquadMapInput,
  type StationPrimitive,
} from "./geometry";

const PLANNED_OPACITY = 0.3;
/** A merge rising into the trunk is a transfer, drawn a little lighter than a line. */
const SPUR_W = 3.5;
const DIM = 0.45;

interface SquadMapProps {
  squad: SquadState;
  view: SquadView;
  now: number;
  selectedRoleId?: string;
  selectedTaskId?: string;
  onSelectTask: (taskId: string) => void;
  onSelectRole: (roleId: string) => void;
}

/** Ink for the trunk, the role's hue for its line: one line, one hue. */
const stroke = (colorKey: string) =>
  colorKey === "integration" ? "var(--ink)" : agentColor(colorKey).line;

/**
 * The squad as a transit system with one trunk: integration across the top, a line per
 * role below it, tasks as stations, merges rising back into the trunk.
 */
export function SquadMap({
  squad,
  view,
  now,
  selectedRoleId,
  selectedTaskId,
  onSelectTask,
  onSelectRole,
}: SquadMapProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const heads = new Map<string, SessionHead>();
  const mapHeads: Record<string, MapHead> = {};
  for (const r of view.roles) {
    const head = sessionHead(r.session, now);
    if (!head?.live) continue;
    heads.set(r.id, head);
    mapHeads[r.id] = {
      label: head.label,
      held: head.held,
      ...(head.askTool ? { askTool: head.askTool } : {}),
    };
  }
  const planner = sessionHead(view.planner?.session, now);

  const input: SquadMapInput = {
    roles: view.roles.map((r) => ({
      id: r.id,
      colorKey: r.colorKey,
      name: r.name,
      code: r.code,
      // Claude Code stays unmarked; a Codex role carries the provider's short mark.
      ...(r.provider === "codex" ? { mark: "Cx", markTitle: t("newSession.provider.codex") } : {}),
    })),
    tasks: view.tasks.map((x) => ({
      id: x.task.id,
      role: x.role,
      title: x.task.title,
      status: x.status,
      foundation: Boolean(x.task.foundation),
      ...(x.merge ? { merge: x.merge.state } : {}),
    })),
    heads: mapHeads,
    ...(selectedRoleId ? { selectedRoleId } : {}),
    ...(selectedTaskId ? { selectedTaskId } : {}),
    // Once the plan is approved, a resting planner has done its part.
    ...(squad.planStatus === "approved"
      ? { plannerLabel: t("persona.done") }
      : planner
        ? { plannerLabel: planner.label }
        : {}),
    finished: squad.phase === "deliver" || squad.phase === "done",
    texts: {
      trunk: t("squad.map.trunk"),
      planner: t("squad.role.planner"),
      foundation: t("squad.track.foundation"),
      build: t("squad.track.build"),
      verify: t("squad.track.verify"),
      deliver: t("squad.track.deliver"),
      hold: t("map.hold"),
      failed: t("squad.task.status.failed"),
      conflicted: t("squad.map.conflict"),
      reverted: t("squad.map.reverted"),
    },
  };
  const layout = layoutSquadMap(input, frame);

  // Merges that land after the first paint rise into the trunk (the one authored move).
  const known = useRef<Set<string> | null>(null);
  const spurKeys = layout.spurs.map((s) => s.taskId).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys stand for the spurs.
  const fresh = useMemo(() => {
    const ids = layout.spurs.map((s) => s.taskId);
    if (!known.current) {
      known.current = new Set(ids);
      return new Set<string>();
    }
    return new Set(ids.filter((id) => !known.current?.has(id)));
  }, [spurKeys]);
  useEffect(() => {
    for (const id of fresh) known.current?.add(id);
  }, [fresh]);

  const primary = useMotionBudget(
    layout.heads.flatMap((h) => {
      const head = heads.get(h.roleId);
      if (!head) return [];
      const changed = changedAt(head.node);
      return [
        {
          id: h.roleId,
          mood: head.persona.mood,
          ...(changed !== undefined ? { changedAt: changed } : {}),
        },
      ];
    }),
    now,
  );

  const taskTitle = (id: string) => view.task(id)?.task.title ?? id;
  const roleName = (id: string) => view.role(id)?.name ?? id;
  const casing = [
    layout.trunk.built,
    layout.trunk.planned,
    ...layout.lines.flatMap((l) => [l.built, l.planned]),
    ...layout.spurs.map((s) => s.d),
  ].filter(Boolean);

  return (
    <div ref={scroller} className="relative h-full overflow-auto">
      <svg
        width={layout.width}
        height={layout.height}
        role="group"
        aria-label={t("squad.map.label", { count: view.roles.length })}
        className="block select-none"
      >
        <g>
          {layout.zone.rules.map((x) => (
            <line
              key={`z-${x}`}
              x1={x}
              x2={x}
              y1={layout.zone.y1}
              y2={layout.zone.y2}
              stroke="var(--hairline-strong)"
              strokeDasharray="2 4"
            />
          ))}
          {layout.zone.labels.map((z) => (
            <text
              key={`zl-${z.text}`}
              x={z.x}
              y={layout.zone.labelY}
              fontSize={11}
              fontWeight={600}
              className="fill-ink-3"
            >
              {z.text}
            </text>
          ))}
        </g>

        {/* Ground casing under every line, so crossings read over and under. */}
        {casing.map((d) => (
          <path
            key={`c-${d}`}
            d={d}
            fill="none"
            stroke="var(--ground)"
            strokeWidth={LINE_W + 5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        <LinePaths line={layout.trunk} />
        {layout.lines.map((l) => (
          <g
            key={`l-${l.id}`}
            opacity={l.dimmed ? DIM : 1}
            role="button"
            tabIndex={-1}
            aria-label={roleName(l.id)}
            onClick={() => onSelectRole(l.id)}
            onKeyDown={(e) => e.key === "Enter" && onSelectRole(l.id)}
            cursor="pointer"
          >
            <LinePaths line={l} />
          </g>
        ))}
        {layout.spurs.map((s) => {
          const grow = fresh.has(s.taskId);
          const undone = s.state === "conflicted" || s.state === "reverted";
          return (
            <path
              key={`s-${s.taskId}`}
              d={s.d}
              fill="none"
              stroke={stroke(s.colorKey)}
              strokeWidth={SPUR_W}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={(s.dimmed ? DIM : 1) * (undone ? PLANNED_OPACITY + 0.2 : 1)}
              strokeDasharray={grow ? "600" : undefined}
              className={grow ? "line-grow" : undefined}
              style={grow ? ({ ["--len" as string]: 600 } as CSSProperties) : undefined}
            />
          );
        })}

        <line
          x1={layout.terminus.x}
          x2={layout.terminus.x}
          y1={layout.terminus.y - 9}
          y2={layout.terminus.y + 9}
          stroke="var(--ink)"
          strokeWidth={LINE_W}
          strokeLinecap="round"
          opacity={squad.phase === "deliver" || squad.phase === "done" ? 1 : PLANNED_OPACITY}
        />

        <Capsules
          items={layout.capsules}
          titleOf={(c) =>
            c.kind === "spawn"
              ? roleName(c.roleId)
              : `${taskTitle(c.taskId ?? "")} · ${t(`squad.merge.${c.state ?? "started"}`)}`
          }
          onSelectTask={onSelectTask}
          width={Math.min(13, Math.max(8, layout.colW * 0.5))}
        />

        {layout.stations.map((s) => (
          <Station
            key={`st-${s.taskId}`}
            station={s}
            label={`${taskTitle(s.taskId)} · ${t(`squad.task.status.${s.status}`)} · ${roleName(s.roleId)}`}
            onSelect={() => onSelectTask(s.taskId)}
          />
        ))}
        {layout.stations.map((s) => (
          <text
            key={`sl-${s.taskId}`}
            x={s.label.x}
            y={s.label.y}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            className={s.status === "pending" || s.status === "ready" ? "fill-ink-3" : "fill-ink-2"}
            stroke="var(--ground)"
            strokeWidth={4}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {s.label.lines.map((line, i) => (
              <tspan key={line} x={s.label.x} dy={i === 0 ? 0 : 13}>
                {line}
              </tspan>
            ))}
          </text>
        ))}
        {layout.signage.map((g) => (
          <text
            key={`g-${g.key}`}
            x={g.x}
            y={g.y}
            textAnchor={g.anchor}
            fontSize={11}
            fontWeight={g.held || g.error ? 700 : 600}
            className={g.error ? "fill-error-ink" : g.held ? "fill-waiting-ink" : "fill-ink-2"}
            stroke="var(--ground)"
            strokeWidth={4}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {g.text}
          </text>
        ))}

        {layout.labels.map((l) => (
          <Label
            key={`t-${l.id}`}
            label={l}
            onSelect={l.id === "integration" ? undefined : onSelectRole}
          />
        ))}

        <g
          transform={`translate(${layout.origin.cx - PLANNER_ORB / 2}, ${layout.origin.cy - PLANNER_ORB / 2})`}
        >
          <Orb
            label={`${t("squad.role.planner")} ${planner ? planner.label : ""}`}
            color={agentColor("planner")}
            persona={planner?.persona ?? RESTING}
            size={PLANNER_ORB}
            glyph={false}
            motion="ambient"
            seed={`${squad.id}:planner`}
          />
        </g>

        {layout.heads.map((h) => {
          const head = heads.get(h.roleId);
          if (!head) return null;
          return (
            <g
              key={`o-${h.roleId}`}
              transform={`translate(${h.cx - ORB / 2}, ${h.cy - ORB / 2})`}
              role="button"
              tabIndex={0}
              aria-label={`${roleName(h.roleId)} ${head.label}`}
              onClick={() => onSelectRole(h.roleId)}
              onKeyDown={(e) => e.key === "Enter" && onSelectRole(h.roleId)}
              cursor="pointer"
              opacity={selectedRoleId && selectedRoleId !== h.roleId ? DIM + 0.2 : 1}
            >
              <Orb
                color={agentColor(h.colorKey)}
                persona={head.persona}
                size={ORB}
                seed={`${squad.id}:${h.roleId}`}
                motion={primary.has(h.roleId) ? "primary" : "ambient"}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Spawns and merges on the trunk: a capsule with a pip in the role's hue. */
function Capsules({
  items,
  titleOf,
  onSelectTask,
  width,
}: {
  items: CapsulePrimitive[];
  titleOf: (c: CapsulePrimitive) => string;
  onSelectTask: (taskId: string) => void;
  /** Narrower in a dense map, so neighbouring capsules don't touch. */
  width: number;
}) {
  const r = width / 2;
  return (
    <>
      {items.map((c) => {
        const red = c.state === "conflicted" || c.state === "reverted";
        const select = c.taskId ? () => onSelectTask(c.taskId as string) : undefined;
        return (
          <g
            key={c.key}
            role="button"
            tabIndex={-1}
            aria-label={titleOf(c)}
            onClick={select}
            onKeyDown={(e) => e.key === "Enter" && select?.()}
            cursor={select ? "pointer" : undefined}
          >
            <title>{titleOf(c)}</title>
            <rect
              x={c.cx - r}
              y={c.cy - r}
              width={width}
              height={width + 12}
              rx={r}
              fill="var(--station)"
              stroke={red ? "var(--error)" : "var(--ink)"}
              strokeWidth={red ? 2.6 : 2.2}
            />
            <circle
              cx={c.cx}
              cy={c.cy}
              r={Math.min(2.6, r - 2)}
              fill={agentColor(c.colorKey).line}
            />
            {red && (
              // A cross in the capsule's tail: the merge didn't hold, in shape as well as red.
              <path
                d={`M ${c.cx - 2.6} ${c.cy + 6.4} l 5.2 5.2 m 0 -5.2 l -5.2 5.2`}
                stroke="var(--error)"
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}
    </>
  );
}

const QUIET: ReadonlySet<TaskStatus> = new Set(["pending", "ready", "skipped"]);

/** A task as a station: hollow ahead, filled while running, ringed red or orange when stuck. */
function Station({
  station: s,
  label,
  onSelect,
}: {
  station: StationPrimitive;
  label: string;
  onSelect: () => void;
}) {
  const quiet = QUIET.has(s.status);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-current={s.selected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      cursor="pointer"
      className="map-target"
    >
      <title>{label}</title>
      {/* A generous hit area; the mark itself stays small. */}
      <circle cx={s.cx} cy={s.cy} r={12} fill="transparent" />
      {s.selected && (
        <circle cx={s.cx} cy={s.cy} r={9.5} fill="none" stroke="var(--ink)" strokeWidth={2} />
      )}
      {s.status === "blocked" ? (
        <>
          <circle
            cx={s.cx}
            cy={s.cy}
            r={9}
            fill="none"
            stroke="var(--waiting)"
            strokeWidth={2}
            className="ring-pulse"
          />
          <circle
            cx={s.cx}
            cy={s.cy}
            r={6.5}
            fill="var(--station)"
            stroke="var(--waiting)"
            strokeWidth={2.6}
          />
        </>
      ) : s.status === "failed" ? (
        <>
          <circle
            cx={s.cx}
            cy={s.cy}
            r={6.5}
            fill="var(--station)"
            stroke="var(--error)"
            strokeWidth={2.4}
          />
          <path
            d={`M ${s.cx - 2.6} ${s.cy - 2.6} l 5.2 5.2 m 0 -5.2 l -5.2 5.2`}
            stroke="var(--error)"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </>
      ) : (
        <circle
          cx={s.cx}
          cy={s.cy}
          r={quiet ? 4 : 4.6}
          fill={s.status === "running" ? "var(--ink)" : "var(--station)"}
          stroke={quiet ? "var(--ink-3)" : "var(--ink)"}
          strokeWidth={quiet ? 1.6 : 2}
        />
      )}
      {s.status === "review" && <circle cx={s.cx} cy={s.cy} r={1.8} fill="var(--ink)" />}
      {s.status === "skipped" && (
        <line
          x1={s.cx - 3.5}
          y1={s.cy + 3.5}
          x2={s.cx + 3.5}
          y2={s.cy - 3.5}
          stroke="var(--ink-3)"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

/** A line's name with its code disc; on a knockout so crossing lines don't cut it. */
function Label({
  label: l,
  onSelect,
}: {
  label: LabelPrimitive;
  onSelect?: ((id: string) => void) | undefined;
}) {
  if (!onSelect) return <LabelMark label={l} />;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={l.full}
      onClick={() => onSelect(l.id)}
      onKeyDown={(e) => e.key === "Enter" && onSelect(l.id)}
      cursor="pointer"
    >
      <LabelMark label={l} />
    </g>
  );
}

function LabelMark({ label: l }: { label: LabelPrimitive }) {
  const trunk = l.colorKey === "integration";
  const color = trunk ? undefined : agentColor(l.colorKey);
  return (
    <g>
      <title>{l.full}</title>
      <rect
        x={l.x - 2}
        y={l.y - 10}
        width={l.textW + 27 + (l.mark ? MARK_W + 6 : 0)}
        height={20}
        rx={6}
        fill="var(--ground)"
        opacity={0.92}
      />
      <circle cx={l.x + 8} cy={l.y} r={8} fill={trunk ? "var(--ink)" : color?.badge} />
      <text
        x={l.x + 8}
        y={l.y + 3.5}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        fill={trunk ? "var(--ground)" : color?.badgeText}
      >
        {l.code}
      </text>
      <text
        x={l.x + 21}
        y={l.y + 4}
        fontSize={12}
        fontWeight={600}
        className="fill-ink"
        stroke="var(--ground)"
        strokeWidth={4}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        {l.text}
      </text>
      {l.mark && (
        // The provider as signage: an outlined ink pill, never a brand colour.
        <g>
          <rect
            x={l.x + 25 + l.textW}
            y={l.y - 7.5}
            width={MARK_W}
            height={15}
            rx={7.5}
            fill="var(--ground)"
            className="stroke-hairline-strong"
            strokeWidth={1}
          />
          <text
            x={l.x + 25 + l.textW + MARK_W / 2}
            y={l.y + 3.5}
            textAnchor="middle"
            fontSize={9.5}
            fontWeight={600}
            className="fill-ink-2"
          >
            {l.mark}
          </text>
        </g>
      )}
    </g>
  );
}

/** A line as built (solid) and planned (faint): the route ahead is drawn, lighter. */
function LinePaths({ line: l }: { line: LinePrimitive }) {
  return (
    <>
      {l.planned && (
        <path
          d={l.planned}
          fill="none"
          stroke={stroke(l.colorKey)}
          strokeWidth={LINE_W}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={PLANNED_OPACITY}
        />
      )}
      {l.built && (
        <path
          d={l.built}
          fill="none"
          stroke={stroke(l.colorKey)}
          strokeWidth={LINE_W}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </>
  );
}
