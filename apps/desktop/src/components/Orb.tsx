import type { Mood, Persona } from "@gravita/core";
import {
  AlertTriangle,
  Check,
  Circle,
  Eye,
  FileText,
  GitBranch,
  Globe,
  Hand,
  HelpCircle,
  List,
  type LucideIcon,
  MessageSquare,
  Moon,
  Pause,
  Pencil,
  Plug,
  Search,
  Sparkles,
  Square,
  Terminal,
  Unlink,
} from "lucide-react";
import { memo } from "react";
import type { AgentColor } from "@/lib/palette";

export const GLYPHS: Record<string, LucideIcon> = {
  hand: Hand,
  pause: Pause,
  alert: AlertTriangle,
  check: Check,
  stop: Square,
  unlink: Unlink,
  dot: Circle,
  branch: GitBranch,
  eye: Eye,
  spark: Sparkles,
  bubble: MessageSquare,
  moon: Moon,
  file: FileText,
  search: Search,
  pencil: Pencil,
  terminal: Terminal,
  globe: Globe,
  plug: Plug,
  list: List,
  question: HelpCircle,
};

const BODY_MOTION: Partial<Record<Mood, string>> = {
  idle: "orb-breathe",
  thinking: "orb-breathe",
  focused: "orb-breathe",
  busy: "orb-bob",
  delegating: "orb-bob",
  waiting: "orb-bounce",
  error: "orb-wobble",
};

function pupilOffset(p: Persona): { dx: number; dy: number; r: number } {
  switch (p.gaze.kind) {
    case "tool":
      return { dx: 1.5, dy: 0.4, r: 2.1 };
    case "up":
      return { dx: 0.4, dy: -1.9, r: 2 };
    case "viewer":
      return { dx: 0, dy: 0.6, r: 2.7 };
    case "child":
      return { dx: 1.1, dy: 1.7, r: 2.1 };
    default:
      return { dx: 0, dy: 0, r: p.mood === "error" ? 1.3 : 2.1 };
  }
}

interface OrbProps {
  color: AgentColor;
  persona: Persona;
  size?: number;
  /** Shows the state glyph badge; hide it in dense lists where the label carries state. */
  glyph?: boolean;
  /** Pop-in on first render, for freshly spawned agents. */
  pop?: boolean;
  label?: string;
}

/** The agent persona: a coloured orb with expressive eyes. Pure SVG, CSS-animated. */
export const Orb = memo(function Orb({
  color,
  persona,
  size = 32,
  glyph = true,
  pop,
  label,
}: OrbProps) {
  const { dx, dy, r } = pupilOffset(persona);
  const closed = persona.gaze.kind === "closed";
  const happy = persona.mood === "done";
  const dim = persona.mood === "stopped" || persona.mood === "away";
  const Icon = GLYPHS[persona.glyph];
  const breath = persona.mood === "thinking" ? "2.4s" : persona.mood === "idle" ? "4.2s" : "3.2s";

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: labelled orbs carry a <title>; unlabelled ones are aria-hidden decoration.
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role={label ? "img" : "presentation"}
      aria-hidden={label ? undefined : true}
      className={pop ? "orb-pop" : undefined}
      style={{ overflow: "visible", flex: "none" }}
    >
      {label && <title>{label}</title>}
      {persona.mood === "waiting" && (
        <circle
          cx="20"
          cy="20"
          r="18.5"
          fill="none"
          stroke="var(--waiting)"
          strokeWidth="2"
          className="ring-pulse"
        />
      )}
      <g className={BODY_MOTION[persona.mood]} style={{ ["--orb-breath" as string]: breath }}>
        <circle
          cx="20"
          cy="20"
          r="17"
          fill={color.fill}
          stroke="var(--ink)"
          strokeWidth="1.6"
          opacity={dim ? 0.45 : 1}
        />
        <ellipse cx="13.5" cy="11.5" rx="5.5" ry="3" fill="#fff" opacity="0.32" />
        {closed ? (
          <g stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round" fill="none">
            {happy ? (
              <>
                <path d="M10.6 20.5 Q14.5 15.8 18.4 20.5" />
                <path d="M21.6 20.5 Q25.5 15.8 29.4 20.5" />
              </>
            ) : (
              <>
                <path d="M11 19.5 H18" />
                <path d="M22 19.5 H29" />
              </>
            )}
          </g>
        ) : (
          <g className="orb-blink">
            <ellipse
              cx="14.5"
              cy="19"
              rx="4.3"
              ry="5.1"
              fill="#fff"
              stroke="var(--ink)"
              strokeWidth="0.8"
            />
            <ellipse
              cx="25.5"
              cy="19"
              rx="4.3"
              ry="5.1"
              fill="#fff"
              stroke="var(--ink)"
              strokeWidth="0.8"
            />
            <g
              className={persona.gaze.kind === "wander" ? "orb-wander" : undefined}
              style={{
                transition: "transform 240ms var(--ease-signature)",
                transform: `translate(${dx}px, ${dy}px)`,
              }}
            >
              <circle cx="14.5" cy="19.4" r={r} fill="#121417" />
              <circle cx="25.5" cy="19.4" r={r} fill="#121417" />
              <circle cx={14.5 + 0.8} cy={18.4} r="0.7" fill="#fff" />
              <circle cx={25.5 + 0.8} cy={18.4} r="0.7" fill="#fff" />
            </g>
          </g>
        )}
      </g>
      {glyph && Icon && (
        <g>
          <circle
            cx="33"
            cy="33"
            r="7"
            fill="var(--ground)"
            stroke="var(--ink)"
            strokeWidth="1.2"
          />
          <Icon
            x={28.5}
            y={28.5}
            width={9}
            height={9}
            strokeWidth={2.4}
            color="var(--ink)"
            aria-hidden="true"
          />
        </g>
      )}
    </svg>
  );
});
