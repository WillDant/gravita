import { t } from "@/shared/i18n/i18n";
import { cn } from "@/shared/utils";

/**
 * The providers that carry a mark, with their name and a two-letter short form for tight
 * rows. Claude Code is Gravita's default provider, so its sessions stay unmarked
 * everywhere, also beside Codex rows: the mark flags the exception, and one quiet pill in a
 * list reads cleaner than a pill on every row.
 */
const MARKS: Readonly<Record<string, { name: string; short: string; label: string }>> = {
  codex: { name: "Codex", short: "Cx", label: "provider.codex.session" },
  cursor: { name: "Cursor", short: "Cu", label: "provider.cursor.session" },
};

/**
 * Which agent runs a session, as station signage: an outlined ink pill with the provider's
 * name, never a brand colour (hues belong to agent lines). Outlined rather than filled so
 * it can't be mistaken for a line-code disc. Renders nothing for an unmarked provider.
 */
export function ProviderMark({
  provider,
  compact,
  className,
}: {
  provider: string;
  /** "Cx" instead of "Codex", where a row has no room for the name. */
  compact?: boolean;
  className?: string;
}) {
  const mark = MARKS[provider];
  if (!mark) return null;
  const label = t(mark.label);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-[18px] flex-none items-center rounded-full border border-hairline-strong px-1.5 text-2xs leading-none font-semibold text-ink-2",
        className,
      )}
    >
      {compact ? mark.short : mark.name}
    </span>
  );
}
