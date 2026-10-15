import { useEffect, useId } from "react";
import { t } from "@/shared/i18n/i18n";
import { Button } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";

/** Centered confirmation over the app; same tone as inline confirms (primary + ghost). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const cancel = cancelLabel ?? t("session.removeCancel");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Pressing the dimmed backdrop cancels; the keyboard has Escape, so it skips the tab order. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onMouseDown={onCancel}
        className="absolute inset-0 cursor-default bg-scrim"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative w-full max-w-md rounded-xl border border-hairline bg-panel px-5 py-4 shadow-panel",
        )}
      >
        <h2 id={titleId} className="text-sm font-semibold text-ink">
          {title}
        </h2>
        <p className="mt-2 text-sm text-ink-2">{message}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancel}
          </Button>
          <Button variant="primary" aria-busy={busy} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
