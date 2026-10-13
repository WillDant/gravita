import { X } from "lucide-react";
import { useEffect } from "react";
import { t, useLocale } from "@/shared/i18n/i18n";
import { useAppStore, useNotice } from "@/state/hooks";

/** How long a notice stays before it clears itself. */
export const NOTICE_MS = 8_000;

/**
 * A calm, dismissable line under the window's top edge for things the app did on its own
 * (e.g. the tray's "Stop all"). Neutral panel colours: a notice is news, not an alarm.
 */
export function NoticeLine() {
  useLocale();
  const notice = useNotice();
  const dismiss = useAppStore((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => dismiss(notice.id), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  // The live region stays mounted so screen readers announce what appears in it.
  return (
    <div role="status" aria-live="polite" className="flex-none">
      {notice && (
        <div className="flex items-center gap-3 border-b border-hairline bg-panel py-1.5 pr-3 pl-6 text-sm text-ink-2">
          <span className="min-w-0 flex-1">{t(notice.key, notice.params)}</span>
          <button
            type="button"
            onClick={() => dismiss(notice.id)}
            aria-label={t("notice.dismiss")}
            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
