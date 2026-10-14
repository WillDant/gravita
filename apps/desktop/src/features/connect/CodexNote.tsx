import { useId, useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { cn } from "@/shared/utils";
import { ConnectProvider } from "./ConnectProvider";

/**
 * One quiet line about an optional agent (Codex by default, or Cursor), never a banner:
 * Claude-only users only read it on an empty Home, and the steps open on demand under it.
 */
export function CodexNote({
  note,
  provider = "codex",
  className,
}: {
  note: "missing" | "outdated";
  provider?: "codex" | "cursor";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const stepsId = useId();
  return (
    <div className={cn("text-sm text-ink-3", className)}>
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span>{t(`home.${provider}.${note}`)}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={stepsId}
          onClick={() => setOpen((v) => !v)}
          className="rounded-sm font-medium text-ink-2 underline decoration-hairline-strong underline-offset-[3px] transition-colors hover:text-ink hover:decoration-ink-3"
        >
          {t(open ? "home.codex.hide" : `home.codex.show.${note}`)}
        </button>
      </p>
      <div id={stepsId} hidden={!open}>
        {open && <ConnectProvider provider={provider} problem={note} className="mt-3" />}
      </div>
    </div>
  );
}
