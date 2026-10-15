import type { ElementType, LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utils";

/**
 * A form field's small caption with an icon before it: the icon is decoration (the text
 * names the field), and sits in the quiet tone of a hint.
 */
export function FieldLabel({
  icon,
  as: Tag = "label",
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLElement> & {
  icon: ReactNode;
  /** `legend` for a fieldset's caption, `span` for a caption another element names. */
  as?: Extract<ElementType, "label" | "legend" | "span">;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn("flex items-center gap-1.5 text-xs font-semibold text-ink-2", className)}
      {...props}
    >
      <span aria-hidden="true" className="flex-none text-ink-3">
        {icon}
      </span>
      {children}
    </Tag>
  );
}
