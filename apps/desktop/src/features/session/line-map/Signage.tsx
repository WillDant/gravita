import type { SignagePrimitive } from "./geometry";

/** Under each head orb: where that agent is right now ("Reading app.ts", "On hold · Bash"). */
export function Signage({ items }: { items: SignagePrimitive[] }) {
  return (
    <>
      {items.map((s) => (
        <text
          key={`s-${s.agentId}`}
          x={s.x}
          y={s.y}
          textAnchor="end"
          fontSize={11}
          fontWeight={s.held ? 700 : 600}
          className={s.held ? "fill-waiting-ink" : "fill-ink-2"}
          stroke="var(--ground)"
          strokeWidth={4}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {s.text}
        </text>
      ))}
    </>
  );
}
