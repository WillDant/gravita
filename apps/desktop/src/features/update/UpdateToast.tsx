import { Download, X } from "lucide-react";
import { useState } from "react";
import { useOpenRelease } from "@/app/providers";
import {
  readDismissedUpdate,
  writeDismissedUpdate,
} from "@/infrastructure/preferences/dismissedUpdate";
import { t, useLocale } from "@/shared/i18n/i18n";
import { Button } from "@/shared/ui/ui";
import { useAvailableUpdate } from "@/state/hooks";

/**
 * A small card in the bottom-right corner when a newer release is out: "Download" opens its
 * page, "Later" sends it away for good (until a still newer release). Nothing installs by
 * itself; the engine finds the release, this only tells.
 */
export function UpdateToast() {
  useLocale();
  const update = useAvailableUpdate();
  const openRelease = useOpenRelease();
  const [dismissed, setDismissed] = useState(readDismissedUpdate);
  const [failed, setFailed] = useState(false);
  if (!update || dismissed === update.version) return null;

  const dismiss = () => {
    writeDismissedUpdate(update.version);
    setDismissed(update.version);
  };
  const download = () => {
    setFailed(false);
    openRelease(update.url).then(dismiss, () => setFailed(true));
  };

  return (
    <aside
      role="status"
      aria-label={t("update.title")}
      className="reveal absolute right-4 bottom-4 z-30 flex w-80 max-w-[calc(100%-2rem)] flex-col gap-3 rounded-xl border border-hairline bg-panel p-4 shadow-float"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-lg bg-ground text-ink ring-1 ring-hairline"
        >
          <Download size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{t("update.title")}</p>
          <p className="text-sm text-ink-2">{t("update.body", { version: update.version })}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("update.later")}
          className="-mt-1 -mr-1 rounded-md p-1.5 text-ink-3 transition-colors hover:bg-panel-2 hover:text-ink"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-xs text-error-ink">
          {t("update.failed")}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={dismiss}>
          {t("update.later")}
        </Button>
        <Button variant="primary" onClick={download}>
          {t("update.download")}
        </Button>
      </div>
    </aside>
  );
}
