import { ChevronDown } from "lucide-react";
import {
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { cn } from "@/shared/utils";

const SELECT_LOOK = {
  /** A secondary button: bordered, on ground. */
  field:
    "h-8 rounded-lg border border-hairline-strong bg-ground pr-7 pl-2.5 text-sm text-ink hover:bg-panel",
  /** A quiet pill for toolbars inside a field (the composer): no border until hovered. */
  ghost:
    "h-7 rounded-md bg-transparent pr-6 pl-2 text-xs text-ink-2 hover:bg-panel-2 hover:text-ink focus-visible:bg-panel-2",
} as const;

/** A native select dressed as a button: familiar, keyboard-complete, 32px (28px as a ghost). */
export function Select({
  className,
  children,
  variant = "field",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { variant?: keyof typeof SELECT_LOOK }) {
  return (
    <span className={cn("relative inline-flex min-w-0", className)}>
      <select
        className={cn(
          "w-full min-w-0 cursor-pointer appearance-none truncate font-medium transition-colors disabled:cursor-default disabled:opacity-60",
          SELECT_LOOK[variant],
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={variant === "ghost" ? 12 : 14}
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-3",
          variant === "ghost" ? "right-1.5" : "right-2",
        )}
      />
    </span>
  );
}

/** A textarea that grows with its text up to `maxRows`, then scrolls. */
export function AutoTextarea({
  maxRows = 8,
  className,
  value,
  ref: outer,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  maxRows?: number;
  value: string;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(outer, () => ref.current as HTMLTextAreaElement, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the height follows the text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + 16)}px`;
  }, [value, maxRows]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={cn(
        "block w-full resize-none bg-transparent text-base leading-normal text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  );
}

/** The bordered frame form fields sit in; the focus ring follows the field inside. */
export const fieldFrame =
  "rounded-lg border border-hairline-strong bg-ground transition-colors focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/20";
