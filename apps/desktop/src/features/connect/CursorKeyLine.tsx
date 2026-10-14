import { useNavigate } from "@/app/providers";
import { t } from "@/shared/i18n/i18n";
import { cn } from "@/shared/utils";
import { useCursorCredential } from "@/state/hooks";

/**
 * Home's one quiet line about the Cursor key, once the engine found a usable Cursor: what
 * the key's state is, and a link to Settings to add or manage it.
 */
export function CursorKeyLine({ className }: { className?: string }) {
  const credential = useCursorCredential();
  const navigate = useNavigate();
  if (!credential) return null;
  const state = credential.source === "app" ? credential.state : "missing";
  const linkLabel =
    state === "missing" ? t("home.cursor.key.configure") : t("home.cursor.key.manage");
  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-ink-3", className)}>
      <span>{t(`home.cursor.key.${state}`)}</span>
      <button
        type="button"
        onClick={() => navigate({ level: "settings" })}
        className="rounded-sm font-medium text-ink-2 underline decoration-hairline-strong underline-offset-[3px] transition-colors hover:text-ink hover:decoration-ink-3"
      >
        {linkLabel}
      </button>
    </p>
  );
}
