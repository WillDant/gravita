import type { SquadState } from "@gravita/core";
import type { SquadPhase } from "@gravita/protocol";
import { t } from "@/shared/i18n/i18n";
import { PHASE_STOPS, phaseStop } from "@/shared/presenters/squad";

const GAP = 66;
const ORDER: readonly SquadPhase[] = [
  "brief",
  "planning",
  "review",
  "foundation",
  "build",
  "verify",
  "deliver",
];

/** The furthest stop a squad entered, from the phases it went through. */
function lastStop(q: SquadState) {
  const entered = ORDER.filter((p) => (q.phaseRounds[p] ?? 0) > 0).at(-1);
  return entered ? phaseStop(entered) : "brief";
}
const PAD = 28;
const Y = 9;

/**
 * Where the squad is, drawn as its own short metro line: stops passed are filled, the
 * current stop is ringed, the line ahead is faint. Not a progress bar: a route.
 */
export function PhaseTrack({
  squad: q,
  compact = false,
}: {
  squad: SquadState;
  /** Narrow headers: stops closer together, only the current stop named. */
  compact?: boolean;
}) {
  const phase = q.phase;
  const failed = phase === "failed";
  const stopped = phase === "stopped";
  // A failed or stopped squad keeps the last stop it reached, ringed in its state.
  const at = phaseStop(phase) ?? lastStop(q);
  const index = at ? PHASE_STOPS.indexOf(at) : -1;
  const reached = index >= 0 ? index : 0;
  const done = phase === "done" || Boolean(q.delivered);
  const gap = compact ? 24 : GAP;
  const pad = compact ? 32 : PAD;
  const width = pad * 2 + gap * (PHASE_STOPS.length - 1);
  const x = (i: number) => pad + i * gap;
  const current = at ? t(`squad.track.${at}`) : t(`squad.phase.${phase}`);

  return (
    <svg
      width={width}
      height={34}
      viewBox={`0 0 ${width} 34`}
      role="img"
      aria-label={t("squad.track.label", {
        stop: current,
        n: reached + 1,
        total: PHASE_STOPS.length,
      })}
      className="block flex-none"
    >
      <path
        d={`M ${x(0)} ${Y} H ${x(PHASE_STOPS.length - 1)}`}
        stroke="var(--hairline-strong)"
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
      />
      {(reached > 0 || done) && (
        <path
          d={`M ${x(0)} ${Y} H ${x(done ? PHASE_STOPS.length - 1 : reached)}`}
          stroke="var(--ink)"
          strokeWidth={4}
          strokeLinecap="round"
          fill="none"
        />
      )}
      {PHASE_STOPS.map((stop, i) => {
        const passed = done || i < reached;
        const here = !done && i === reached && index >= 0;
        const ring = failed ? "var(--error)" : stopped ? "var(--ink-3)" : "var(--ink)";
        return (
          <g key={stop}>
            {here ? (
              <>
                <circle
                  cx={x(i)}
                  cy={Y}
                  r={7.5}
                  fill="var(--station)"
                  stroke={ring}
                  strokeWidth={2.4}
                />
                <circle cx={x(i)} cy={Y} r={3} fill={ring} />
              </>
            ) : (
              <circle
                cx={x(i)}
                cy={Y}
                r={passed ? 4.6 : 4}
                fill={passed ? "var(--ink)" : "var(--station)"}
                stroke={passed ? "var(--ink)" : "var(--ink-3)"}
                strokeWidth={passed ? 2 : 1.6}
              />
            )}
            {(!compact || here || (done && i === PHASE_STOPS.length - 1)) && (
              <text
                x={x(i)}
                y={30}
                textAnchor="middle"
                fontSize={11}
                fontWeight={here ? 700 : 600}
                className={
                  here
                    ? failed
                      ? "fill-error-ink"
                      : "fill-ink"
                    : passed
                      ? "fill-ink-2"
                      : "fill-ink-3"
                }
              >
                {t(`squad.track.${stop}`)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
