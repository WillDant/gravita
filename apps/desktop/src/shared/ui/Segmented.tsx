import type { ReactNode } from "react";
import { cn } from "@/shared/utils";

/**
 * One choice among a few, as a small segmented control: native radios (arrow keys move
 * between them), the chosen one a lifted ground tile, as the lens tabs.
 */
export function Segmented<T extends string>({
  name,
  legend,
  hideLegend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  /** The legend is read by screen readers only (a row's own title names the group). */
  hideLegend?: boolean;
  options: readonly { value: T; label: string; icon?: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className={cn("text-xs font-semibold text-ink-2", hideLegend ? "sr-only" : "mb-1.5")}>
        {legend}
      </legend>
      <div className="inline-flex h-8 gap-0.5 rounded-lg bg-panel p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors motion-reduce:transition-none has-focus-visible:outline-2 has-focus-visible:outline-focus",
              o.disabled
                ? "cursor-not-allowed text-ink-3 opacity-50"
                : "cursor-pointer text-ink-2 hover:text-ink",
              !o.disabled && value === o.value && "bg-ground text-ink shadow-panel",
              !o.disabled && value !== o.value && "text-ink-2",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.icon}
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
