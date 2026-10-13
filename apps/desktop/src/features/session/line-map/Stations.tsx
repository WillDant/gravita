import type { StationPrimitive } from "./geometry";

/** Tool calls as stations: open while done, filled while running, ringed while held. */
export function Stations({ items }: { items: StationPrimitive[] }) {
  return (
    <>
      {items.map((p) => (
        <StationMark key={p.station.id} {...p} />
      ))}
    </>
  );
}

function StationMark({ cx, cy, station: s, showCount }: StationPrimitive) {
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
