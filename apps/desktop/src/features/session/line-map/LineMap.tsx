import {
  buildLineMap,
  effectiveLifecycle,
  isRecentlyLive,
  type Persona,
  type SessionState,
  toPersona,
} from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { agentName } from "@/shared/presenters/agent";
import { type AgentInfo, layoutLineMap } from "./geometry";
import { Heads } from "./Heads";
import { Interchanges } from "./Interchanges";
import { Labels } from "./Labels";
import { Lines, NowMarker } from "./Lines";
import { Signage } from "./Signage";
import { Stations } from "./Stations";
import { changedAt, useMotionBudget } from "./useMotionBudget";

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

  const personas = new Map<string, Persona>();
  const agents: Record<string, AgentInfo> = {};
  for (const l of map.lines) {
    const node = session.agents[l.agentId];
    if (!node) continue;
    const persona = toPersona(node, session, now);
    personas.set(l.agentId, persona);
    const ask = Object.values(node.permissions ?? {})[0];
    agents[l.agentId] = {
      lifecycle: effectiveLifecycle(node, session, now),
      label: t(persona.label.key, persona.label.params),
      ...(ask ? { askTool: ask.toolName } : {}),
    };
  }

  const layout = layoutLineMap(map, frame, {
    live: isRecentlyLive(session, now),
    agents,
    selectedAgentId,
    texts: { main: t("agent.main"), hold: t("map.hold") },
  });

  // The 1/3 rule over the orbs riding the map: who may bounce or pop right now.
  const primary = useMotionBudget(
    layout.heads.flatMap((h) => {
      const persona = personas.get(h.agentId);
      const node = session.agents[h.agentId];
      if (!persona || !node) return [];
      const changed = changedAt(node);
      return [
        {
          id: h.agentId,
          mood: persona.mood,
          ...(fresh.has(h.agentId) ? { spawnedAt: now } : {}),
          ...(changed !== undefined ? { changedAt: changed } : {}),
        },
      ];
    }),
    now,
  );

  // Follow "now" like a departures board, unless the user scrolled back in time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run whenever the map grows wider.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollLeft = el.scrollWidth;
  }, [layout.width]);

  const lineName = (agentId: string) => {
    const line = map.lines.find((l) => l.agentId === agentId);
    return line ? agentName(line) : agentId;
  };

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
        width={layout.width}
        height={layout.height}
        role="group"
        aria-label={t("count.lines", { count: map.lines.length })}
        className="block select-none"
      >
        {layout.now && <NowMarker rule={layout.now} label={t("session.now")} />}
        <Lines paths={layout.paths} fresh={fresh} nameOf={lineName} onSelect={onSelectAgent} />
        <Interchanges items={layout.interchanges} links={layout.links} />
        <Stations items={layout.stations} />
        <Signage items={layout.signage} />
        <Labels items={layout.labels} onSelect={onSelectAgent} />
        <Heads
          items={layout.heads}
          personaOf={(id) => personas.get(id)}
          ariaLabelOf={(id) => {
            const p = personas.get(id);
            return `${lineName(id)} ${p ? t(p.label.key, p.label.params) : ""}`;
          }}
          fresh={fresh}
          primary={primary}
          onSelect={onSelectAgent}
        />
      </svg>
    </div>
  );
}
