import type { Station } from "@gravita/core";
import { t } from "@/shared/i18n/i18n";
import { cn } from "@/shared/utils";

/** Plain-language sentences, one per station, drawn as a route with stops. */
export function Story({ stations, color }: { stations: Station[]; color: string }) {
  if (stations.length === 0) return <p className="text-sm text-ink-2">{t("agent.noSteps")}</p>;
  return (
    <ol className="relative">
      <span
        aria-hidden="true"
        className="absolute top-2 bottom-2 left-[7px] w-[3px] rounded-full"
        style={{ background: color }}
      />
      {stations.map((s) => (
        <li key={s.id} className="relative flex gap-3 py-1.5 pl-0">
          <span
            aria-hidden="true"
            className={cn(
              "relative z-[1] mt-[3px] size-[17px] flex-none rounded-full border-2 bg-ground",
              s.status === "error"
                ? "border-error"
                : s.status === "waiting"
                  ? "border-waiting"
                  : "border-ink",
            )}
          />
          <span className="text-sm leading-snug">
            {t(`story.${s.kind}`, { count: s.count, target: s.label })}
            {s.status === "error" && <span className="text-error-ink"> · {t("story.failed")}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Steps({ stations, color }: { stations: Station[]; color: string }) {
  if (stations.length === 0) return <p className="text-sm text-ink-2">{t("agent.noSteps")}</p>;
  return (
    <ol className="flex flex-col">
      {stations.map((s) => (
        <li
          key={s.id}
          className="flex items-baseline gap-3 border-b border-hairline py-2 text-sm last:border-0"
        >
          <span className="w-14 flex-none text-xs text-ink-3 tabular">
            {s.startTs
              ? new Date(s.startTs).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : ""}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="font-semibold"
              style={{ color: s.status === "error" ? "var(--error-ink)" : undefined }}
            >
              {s.name}
            </span>{" "}
            <span className="break-all font-mono text-xs text-ink-2">{s.label}</span>
            {s.count > 1 && <span className="ml-1 text-xs text-ink-3 tabular">×{s.count}</span>}
          </span>
          <span
            aria-hidden="true"
            className="size-2 flex-none rounded-full"
            style={{
              background: s.status === "running" ? color : "transparent",
              border: `2px solid ${color}`,
            }}
          />
        </li>
      ))}
    </ol>
  );
}
