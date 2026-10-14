import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/shared/utils";

const STEP = 24;

function readWidth(key: string): number | undefined {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function saveWidth(key: string, width: number) {
  try {
    localStorage.setItem(key, String(Math.round(width)));
  } catch {}
}

/**
 * Two panes side by side, the end one resizable by dragging the hairline between them or by
 * the arrow keys on it. Its width is remembered per `storageKey`. Each side keeps its
 * minimum; the start pane takes what's left. `show` hides one side without unmounting it,
 * so what it holds (a terminal, a map) keeps its state.
 */
export function SplitPane({
  start,
  end,
  storageKey,
  label,
  defaultEnd = 440,
  minStart = 420,
  minEnd = 360,
  show = "both",
  className,
}: {
  start: ReactNode;
  end: ReactNode;
  storageKey: string;
  /** Names the separator for assistive tech. */
  label: string;
  defaultEnd?: number;
  minStart?: number;
  minEnd?: number;
  show?: "both" | "start" | "end";
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => readWidth(storageKey) ?? defaultEnd);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setTotal(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = Math.max(minEnd, (total || defaultEnd + minStart) - minStart);
  const clamp = useCallback((w: number) => Math.min(max, Math.max(minEnd, w)), [max, minEnd]);
  const shown = clamp(width);

  const commit = (w: number) => {
    const next = clamp(w);
    setWidth(next);
    saveWidth(storageKey, next);
  };

  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const right = el.getBoundingClientRect().right;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setWidth(clamp(right - ev.clientX));
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      commit(right - ev.clientX);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  return (
    <div ref={box} className={cn("flex min-h-0 min-w-0 flex-1", className)}>
      <div hidden={show === "end"} className="flex min-w-0 flex-1 flex-col">
        {start}
      </div>
      <div
        hidden={show !== "both"}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={minEnd}
        aria-valuemax={max}
        aria-valuenow={Math.round(shown)}
        tabIndex={0}
        onPointerDown={drag}
        onDoubleClick={() => commit(defaultEnd)}
        onKeyDown={(e) => {
          const next =
            e.key === "ArrowLeft"
              ? shown + STEP
              : e.key === "ArrowRight"
                ? shown - STEP
                : e.key === "Home"
                  ? max
                  : e.key === "End"
                    ? minEnd
                    : undefined;
          if (next === undefined) return;
          e.preventDefault();
          commit(next);
        }}
        className="group relative z-10 -mx-1 w-2 flex-none cursor-col-resize touch-none focus-visible:outline-none"
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-hairline transition-colors group-hover:bg-hairline-strong group-focus-visible:w-0.5 group-focus-visible:bg-focus"
        />
      </div>
      <div
        hidden={show === "start"}
        className={cn("flex min-w-0 flex-col", show === "end" ? "flex-1" : "flex-none")}
        style={show === "end" ? undefined : { width: shown }}
      >
        {end}
      </div>
    </div>
  );
}
