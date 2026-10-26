import { BellRing } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useNotificationPrefs } from "@/app/providers";
import type { NotificationPrefs } from "@/infrastructure/preferences/notificationPrefs";
import { t, useLocale } from "@/shared/i18n/i18n";
import { cn } from "@/shared/utils";

const TOGGLES: { key: keyof NotificationPrefs; label: string }[] = [
  { key: "waiting", label: "notify.pref.waiting" },
  { key: "finished", label: "notify.pref.finished" },
  { key: "failures", label: "notify.pref.failures" },
];

/**
 * The three notification switches, as checkboxes: in the sidebar's small popover, and (with
 * an icon for each) on the Settings screen.
 */
export function NotificationToggles({
  icons,
  className,
}: {
  /** An icon per switch; the popover goes without. */
  icons?: Readonly<Record<keyof NotificationPrefs, ReactNode>>;
  className?: string;
}) {
  useLocale();
  const [prefs, setPrefs] = useNotificationPrefs();
  return (
    <div className={className}>
      {TOGGLES.map(({ key, label }) => (
        <label
          key={key}
          className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 text-sm text-ink-2 hover:text-ink"
        >
          <input
            type="checkbox"
            checked={prefs[key]}
            onChange={(e) => setPrefs({ [key]: e.target.checked })}
            className="mt-[3px] size-3.5 flex-none accent-ink"
          />
          {icons && <span className="mt-px flex-none text-ink-3">{icons[key]}</span>}
          {t(label)}
        </label>
      ))}
    </div>
  );
}

/** The sidebar footer's notification switches: three checkboxes in a small popover. */
export function NotificationSettings() {
  useLocale();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("notify.settings")}
        title={t("notify.settings")}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "rounded-md p-2 text-ink-2 hover:bg-sidebar-hover hover:text-ink",
          open && "bg-sidebar-hover text-ink",
        )}
      >
        <BellRing size={16} aria-hidden="true" />
      </button>
      {open && (
        <fieldset
          id={panelId}
          className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl border border-hairline bg-ground p-3 shadow-float"
        >
          <legend className="float-left mb-0.5 w-full text-sm font-semibold text-ink">
            {t("notify.settings")}
          </legend>
          <p className="mb-2 text-xs text-ink-3">{t("notify.settingsHint")}</p>
          <NotificationToggles />
        </fieldset>
      )}
    </div>
  );
}
