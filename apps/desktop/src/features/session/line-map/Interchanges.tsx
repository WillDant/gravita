import { agentColor } from "@/shared/palette";
import type { InterchangePrimitive } from "./geometry";

/** Where a branch leaves its parent and where it merges back: a capsule with a pip. */
export function Interchanges({ items }: { items: InterchangePrimitive[] }) {
  return (
    <>
      {items.map((i) => (
        <g key={`i-${i.key}`}>
          <rect
            x={i.cx - 6.5}
            y={i.cy - 6.5}
            width={13}
            height={25}
            rx={6.5}
            fill="var(--station)"
            stroke="var(--ink)"
            strokeWidth={2.2}
          />
          <circle cx={i.cx} cy={i.cy} r={2.6} fill={agentColor(i.agentType).line} />
        </g>
      ))}
    </>
  );
}
