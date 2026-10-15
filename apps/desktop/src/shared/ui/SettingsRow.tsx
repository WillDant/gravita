import type { ReactNode } from "react";

/** One preference: an icon tile, its name and hint, and its control (beside, or below). */
export function Row({
  icon,
  title,
  body,
  stacked,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  /** The control sits under the text instead of beside it. */
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={
        stacked ? "flex flex-col gap-3 px-4 py-3.5" : "flex items-center gap-3 px-4 py-3.5"
      }
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-lg bg-ground text-ink ring-1 ring-hairline"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {body && <p className="text-sm text-ink-2">{body}</p>}
        </div>
      </div>
      <div className={stacked ? "pl-10" : "flex-none"}>{children}</div>
    </div>
  );
}
