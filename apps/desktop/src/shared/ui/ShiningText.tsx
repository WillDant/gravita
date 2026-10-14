import { useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { cn } from "@/shared/utils";

/**
 * Text with light sweeping across it, for "the agent is working" lines. The sweep is drawn
 * from the ink tokens, so it reads in both themes; with reduced motion it is plain text.
 * Render inside `<Motion>`.
 */
export function ShiningText({ text, className }: { text: string; className?: string }) {
  const still = useReducedMotion();
  if (still) return <span className={cn("text-ink-2", className)}>{text}</span>;
  return (
    <m.span
      className={cn(
        "bg-[linear-gradient(110deg,var(--ink-3),35%,var(--ink),50%,var(--ink-3),75%,var(--ink-3))] bg-[length:200%_100%] bg-clip-text text-transparent",
        className,
      )}
      initial={{ backgroundPosition: "200% 0" }}
      animate={{ backgroundPosition: "-200% 0" }}
      transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2, ease: "linear" }}
    >
      {text}
    </m.span>
  );
}
