import { X } from "lucide-react";
import { useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { cn } from "@/shared/utils";
import { useAppStore } from "@/state/hooks";

/** X control that asks before `session.remove` (stops a live agent when needed). */
export function RemoveSessionButton({
  sessionId,
  projectId,
  className,
}: {
  sessionId: string;
  projectId: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const removeSession = useAppStore((s) => s.removeSession);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    const r = await removeSession(sessionId, projectId);
    setBusy(false);
    if (r.ok) setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-label={t("session.remove")}
        title={t("session.remove")}
        className={cn(
          "flex-none rounded-md p-1 text-ink-3 opacity-0 transition-opacity hover:bg-panel hover:text-ink group-hover/subitem:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100",
          className,
        )}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
      >
        <X size={14} aria-hidden="true" />
      </button>
      {open && (
        <ConfirmDialog
          title={t("session.remove")}
          message={t("session.removeConfirm")}
          confirmLabel={t("session.removeYes")}
          busy={busy}
          onCancel={() => !busy && setOpen(false)}
          onConfirm={() => void confirm()}
        />
      )}
    </>
  );
}
