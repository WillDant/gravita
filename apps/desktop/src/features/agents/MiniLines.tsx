import { type AgentNode, effectiveLifecycle, type SessionState, TERMINAL } from "@gravita/core";
import { agentColor } from "@gravita/orbs";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import { t } from "@/shared/i18n/i18n";

const W = 176;
const H = 44;
const MAIN_Y = 9;
const LANE = 10;
const MAX_LANES = 3;
const K = 5;

/**
 * A session as a pocket-size line diagram, in the same colours as the full map.
 * Finished subagents are stops on the main line (trips that came back); running ones
 * are branch lines reaching the right edge, with a dot for where they are now.
 */
export function MiniLines({ session, now }: { session: SessionState; now: number }) {
  const main = session.agents[MAIN_AGENT];
  if (!main) return null;
  const subs = Object.values(session.agents)
    .filter((a) => a.id !== MAIN_AGENT)
    .sort((a, b) => a.createdTs.localeCompare(b.createdTs));
  const isLive = (a: AgentNode) => {
    const lc = effectiveLifecycle(a, session, now);
    return !TERMINAL.has(lc) && lc !== "detached";
  };
  const mainLc = effectiveLifecycle(main, session, now);
  const mainLive = mainLc === "active" || mainLc === "waiting_user";
  const step = subs.length ? Math.min(14, (W - 70) / subs.length) : 0;
  const running = subs.filter(isLive);
  const label = `${t("count.subagents", { count: subs.length })}, ${t("count.active", { count: running.length })}`;
  let lane = 0;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className="block flex-none"
    >
      <line
        x1={4}
        x2={W - 10}
        y1={MAIN_Y}
        y2={MAIN_Y}
        stroke={agentColor("main").line}
        strokeWidth={3}
        strokeLinecap="round"
        opacity={mainLive ? 1 : 0.45}
      />
      {subs.map((a, i) => {
        const x = 12 + i * step;
        const color = agentColor(a.agentType).line;
        if (!isLive(a)) {
          return (
            <circle
              key={a.id}
              cx={x}
              cy={MAIN_Y}
              r={2.6}
              fill="var(--ground)"
              stroke={color}
              strokeWidth={1.8}
            />
          );
        }
        const y = MAIN_Y + Math.min(++lane, MAX_LANES) * LANE;
        const waiting = effectiveLifecycle(a, session, now) === "waiting_user";
        const d = `M ${x} ${MAIN_Y} V ${y - K} L ${x + K} ${y} H ${W - 12}`;
        return (
          <g key={a.id}>
            <path d={d} fill="none" stroke="var(--ground)" strokeWidth={5} strokeLinejoin="round" />
            <path
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={W - 9}
              cy={y}
              r={3.6}
              fill={waiting ? "var(--waiting)" : "var(--ground)"}
              stroke={waiting ? "var(--waiting)" : color}
              strokeWidth={2.2}
            />
          </g>
        );
      })}
      {mainLive && (
        <circle
          cx={W - 8}
          cy={MAIN_Y}
          r={4}
          fill="var(--ground)"
          stroke={agentColor("main").line}
          strokeWidth={2.4}
        />
      )}
    </svg>
  );
}
