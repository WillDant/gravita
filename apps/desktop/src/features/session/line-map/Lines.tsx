import type { CSSProperties } from "react";
import { agentColor } from "@/shared/palette";
import { DIM, LINE_W, type NowRule, type PathPrimitive } from "./geometry";

/** The "now" rule: a dashed hairline with its label, where running lines end. */
export function NowMarker({ rule, label }: { rule: NowRule; label: string }) {
  return (
    <g>
      <line
        x1={rule.x}
        x2={rule.x}
        y1={rule.y1}
        y2={rule.y2}
        stroke="var(--hairline-strong)"
        strokeDasharray="2 4"
      />
      <text
        x={rule.x}
        y={rule.labelY}
        textAnchor="middle"
        fontSize={11}
        fontWeight={600}
        className="fill-ink-3"
      >
        {label}
      </text>
    </g>
  );
}

/** Ground-coloured casing first, then the coloured lines, so crossings read like a transit map. */
export function Lines({
  paths,
  fresh,
  nameOf,
  onSelect,
}: {
  paths: PathPrimitive[];
  /** Lines that appeared after the first paint draw themselves in. */
  fresh: ReadonlySet<string>;
  nameOf: (agentId: string) => string;
  onSelect: (agentId: string) => void;
}) {
  return (
    <>
      {paths.map((p) => (
        <path
          key={`c-${p.agentId}`}
          d={p.d}
          fill="none"
          stroke="var(--ground)"
          strokeWidth={LINE_W + 5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {paths.map((p) => {
        const isFresh = fresh.has(p.agentId);
        return (
          <path
            key={`l-${p.agentId}`}
            d={p.d}
            fill="none"
            stroke={agentColor(p.agentType).line}
            strokeWidth={LINE_W}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={p.detached ? "1 9" : isFresh ? "2000" : undefined}
            className={isFresh ? "line-grow" : undefined}
            style={isFresh ? ({ ["--len" as string]: 2000 } as CSSProperties) : undefined}
            opacity={p.dimmed ? DIM : 1}
            role="button"
            tabIndex={-1}
            aria-label={nameOf(p.agentId)}
            onClick={() => onSelect(p.agentId)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(p.agentId)}
            cursor="pointer"
          />
        );
      })}
    </>
  );
}
