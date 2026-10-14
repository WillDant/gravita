import { type KeyboardEvent, useRef } from "react";
import { cn } from "@/shared/utils";

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

/**
 * A segmented tab list: the chosen tab is a lifted ground tile on a panel track. Arrow keys,
 * Home and End move between tabs (and choose them), as a tab list should.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: KeyboardEvent, i: number) => {
    const last = items.length - 1;
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % items.length
        : e.key === "ArrowLeft"
          ? (i - 1 + items.length) % items.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("flex rounded-lg bg-panel p-0.5", className)}
    >
      {items.map((item, i) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              "h-7 rounded-md px-3 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors",
              selected ? "bg-ground text-ink shadow-panel" : "hover:text-ink",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
