import { agentColor } from "@/shared/palette";
import type { LabelPrimitive } from "./geometry";

/** Line names with their metro code, on a knockout so crossing lines don't cut them. */
export function Labels({
  items,
  onSelect,
}: {
  items: LabelPrimitive[];
  onSelect: (agentId: string) => void;
}) {
  return (
    <>
      {items.map((l) => {
        const color = agentColor(l.agentType);
        return (
          <g
            key={`t-${l.agentId}`}
            role="button"
            tabIndex={0}
            aria-label={l.full}
            onClick={() => onSelect(l.agentId)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(l.agentId)}
            cursor="pointer"
          >
            <title>{l.full}</title>
            {/* Knockout, as on printed metro maps: any other line crossing the name is masked. */}
            <rect
              x={l.x - 2}
              y={l.y - 10}
              width={l.textW + 27}
              height={20}
              rx={6}
              fill="var(--ground)"
              opacity={0.92}
            />
            <circle cx={l.x + 8} cy={l.y} r={8} fill={color.badge} />
            <text
              x={l.x + 8}
              y={l.y + 3.5}
              textAnchor="middle"
              fontSize={10}
              fontWeight={700}
              fill={color.badgeText}
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
          </g>
        );
      })}
    </>
  );
}
