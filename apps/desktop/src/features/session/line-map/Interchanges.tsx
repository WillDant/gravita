import { agentColor } from "@gravita/orbs";
import type { InterchangeLinkPrimitive, InterchangePrimitive } from "./geometry";

/** Height of the connector between linked capsules: a little under the capsule's width. */
const LINK_H = 10;

/**
 * Where a branch leaves its parent and where it merges back: a capsule with a pip.
 * Capsules of one fan-out (or one run of merges) are joined by a white connector with
 * the same ink ring, drawn first so the capsules sit on top of it.
 */
export function Interchanges({
  items,
  links,
}: {
  items: InterchangePrimitive[];
  links: InterchangeLinkPrimitive[];
}) {
  return (
    <>
      {links.map((l) => (
        <rect
          key={`l-${l.key}`}
          x={l.x0}
          y={l.cy - LINK_H / 2}
          width={l.x1 - l.x0}
          height={LINK_H}
          rx={LINK_H / 2}
          fill="var(--station)"
          stroke="var(--ink)"
          strokeWidth={2.2}
        />
      ))}
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
