import type { Persona } from "@gravita/core";
import { agentColor } from "@gravita/orbs";
import { Orb } from "@/features/agents/Orb";
import { type HeadPrimitive, ORB } from "./geometry";

/** The orb riding at the head of each running line. */
export function Heads({
  items,
  personaOf,
  ariaLabelOf,
  fresh,
  primary,
  onSelect,
}: {
  items: HeadPrimitive[];
  personaOf: (agentId: string) => Persona | undefined;
  ariaLabelOf: (agentId: string) => string;
  fresh: ReadonlySet<string>;
  /** Heads the motion budget lets bounce or pop; the rest only breathe. */
  primary: ReadonlySet<string>;
  onSelect: (agentId: string) => void;
}) {
  return (
    <>
      {items.map((h) => {
        const persona = personaOf(h.agentId);
        if (!persona) return null;
        return (
          <g
            key={`o-${h.agentId}`}
            transform={`translate(${h.cx - ORB / 2}, ${h.cy - ORB / 2})`}
            role="button"
            tabIndex={0}
            aria-label={ariaLabelOf(h.agentId)}
            onClick={() => onSelect(h.agentId)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(h.agentId)}
            cursor="pointer"
          >
            <Orb
              color={agentColor(h.agentType)}
              persona={persona}
              size={ORB}
              seed={h.agentId}
              pop={fresh.has(h.agentId)}
              motion={primary.has(h.agentId) ? "primary" : "ambient"}
            />
          </g>
        );
      })}
    </>
  );
}
