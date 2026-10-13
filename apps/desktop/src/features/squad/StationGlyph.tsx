import type { TaskStatus } from "@gravita/protocol";

/** A task's station as a small inline mark, the same shapes the squad map draws. */
export function StationGlyph({ status, size = 16 }: { status: TaskStatus; size?: number }) {
  const c = size / 2;
  const quiet = status === "pending" || status === "ready" || status === "skipped";
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="flex-none"
    >
      {status === "blocked" ? (
        <circle
          cx={c}
          cy={c}
          r={c - 2.4}
          fill="var(--station)"
          stroke="var(--waiting)"
          strokeWidth={2.4}
        />
      ) : (
        <circle
          cx={c}
          cy={c}
          r={quiet ? c - 4 : c - 3}
          fill={status === "running" ? "var(--ink)" : "var(--station)"}
          stroke={status === "failed" ? "var(--error)" : quiet ? "var(--ink-3)" : "var(--ink)"}
          strokeWidth={status === "failed" ? 2.4 : quiet ? 1.6 : 2}
        />
      )}
      {status === "review" && <circle cx={c} cy={c} r={1.6} fill="var(--ink)" />}
      {status === "skipped" && (
        <line
          x1={c - 3}
          y1={c + 3}
          x2={c + 3}
          y2={c - 3}
          stroke="var(--ink-3)"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
