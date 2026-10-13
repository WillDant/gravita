import type { Mood, Persona } from "@gravita/core";
import {
  type AgentColor,
  bodyMotion,
  breathPeriod,
  glyphPath,
  type MotionAllowance,
  pupilOffset,
  seedPhase,
} from "@gravita/orbs";
import { memo } from "react";

const BODY_CLASS = {
  breathe: "orb-breathe",
  bob: "orb-bob",
  bounce: "orb-bounce",
  wobble: "orb-wobble",
  still: undefined,
} as const;

const bodyClass = (mood: Mood, motion: MotionAllowance) => BODY_CLASS[bodyMotion(mood, motion)];

interface OrbProps {
  color: AgentColor;
  persona: Persona;
  size?: number;
  /** Shows the state glyph badge; hide it in dense lists where the label carries state. */
  glyph?: boolean;
  /** Pop-in on first render, for freshly spawned agents. */
  pop?: boolean;
  label?: string;
  /**
   * The 1/3 rule's allowance: `ambient` keeps a waiting or failed orb breathing instead
   * of bouncing or wobbling, and skips the spawn pop. Lone orbs keep `primary`.
   */
  motion?: MotionAllowance;
  /** Phase seed (the agent id), so a list of orbs doesn't breathe and blink in lockstep. */
  seed?: string;
}

/** The agent persona: a coloured orb with expressive eyes. Pure SVG, CSS-animated. */
export const Orb = memo(function Orb({
  color,
  persona,
  size = 32,
  glyph = true,
  pop,
  label,
  motion = "primary",
  seed,
}: OrbProps) {
  const { dx, dy, r } = pupilOffset(persona);
  const closed = persona.gaze.kind === "closed";
  const happy = persona.mood === "done";
  const dim = persona.mood === "stopped" || persona.mood === "away";
  const glyphD = glyphPath(persona.glyph);
  const breath = `${breathPeriod(persona.mood) / 1000}s`;
  const phase = seedPhase(seed);

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: labelled orbs carry a <title>; unlabelled ones are aria-hidden decoration.
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role={label ? "img" : "presentation"}
      aria-hidden={label ? undefined : true}
      className={pop && motion === "primary" ? "orb-pop" : undefined}
      style={{ overflow: "visible", flex: "none", ["--orb-phase" as string]: phase }}
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
      <g className={bodyClass(persona.mood, motion)} style={{ ["--orb-breath" as string]: breath }}>
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
      {glyph && glyphD && (
        <g>
          <circle
            cx="33"
            cy="33"
            r="7"
            fill="var(--ground)"
            stroke="var(--ink)"
            strokeWidth="1.2"
          />
          <path
            d={glyphD}
            transform="translate(28.5 28.5) scale(0.375)"
            fill="none"
            stroke="var(--ink)"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </svg>
  );
});
