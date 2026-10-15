import type { ProjectAppearance } from "@/infrastructure/preferences/projectAppearance";
import { cn } from "@/shared/utils";
import { PROJECT_ICONS } from "./projectIcons";

const SIZES = {
  sm: { box: "size-4 rounded-[4px] text-[10px]", icon: 11 },
  lg: { box: "size-11 rounded-xl text-lg", icon: 24 },
} as const;

/**
 * A project's tile: the icon it was given (else the initial of its name) on the colour it
 * was given (else the quiet neutral), small in lists and large in the project's header.
 */
export function ProjectTile({
  name,
  appearance,
  size = "sm",
  className,
}: {
  name: string;
  appearance?: ProjectAppearance;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { box, icon } = SIZES[size];
  const Icon = appearance?.icon ? PROJECT_ICONS[appearance.icon] : undefined;
  const tone = appearance?.tone && appearance.tone !== "neutral" ? appearance.tone : undefined;
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn(
        "flex flex-none items-center justify-center font-bold uppercase",
        box,
        tone ? "bg-(--tile-bg) text-(--tile-fg)" : "bg-ink-3/20 text-ink-2",
        className,
      )}
    >
      {Icon ? (
        <Icon size={icon} strokeWidth={size === "lg" ? 1.9 : 2.2} />
      ) : (
        name.replace(/[^a-z0-9]/gi, "").slice(0, 1) || "·"
      )}
    </span>
  );
}
