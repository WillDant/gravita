import type { SessionState } from "@gravita/core";
import { ArrowUp, Square } from "lucide-react";
import { useId, useRef } from "react";
import {
  BypassWarning,
  isFullAccess,
  ModelSelect,
  ModeSelect,
} from "@/features/session-settings/SettingsSelects";
import { t } from "@/shared/i18n/i18n";
import { AutoTextarea, fieldFrame } from "@/shared/ui/form";
import { Button } from "@/shared/ui/ui";
import { cn, isSendChord, MOD_KEY } from "@/shared/utils";
import { useModels } from "@/state/hooks";
import { useComposer } from "./useComposer";

/**
 * Talk to a session Gravita runs: message box (⌘↩ sends), model and permissions, and
 * Interrupt standing apart from Send so the destructive action is never a slip away.
 */
export function Composer({
  session,
  settings = true,
  placeholder,
}: {
  session: SessionState;
  /** Model and permission selects; a squad's planner has neither to choose. */
  settings?: boolean;
  placeholder?: string;
}) {
  const c = useComposer(session);
  const models = useModels(c.provider);
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    if (!c.text.trim()) {
      box.current?.focus();
      return;
    }
    c.send();
  };

  return (
    <div className="flex-none border-t border-hairline bg-ground px-6 pt-3 pb-4">
      <div className="flex items-stretch gap-4">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className={cn(fieldFrame, "flex min-w-0 flex-1 flex-col")}
        >
          <label htmlFor={`${id}-text`} className="sr-only">
            {t("composer.label")}
          </label>
          <AutoTextarea
            ref={box}
            id={`${id}-text`}
            value={c.text}
            onChange={(e) => c.setText(e.target.value)}
            onKeyDown={(e) => {
              if (isSendChord(e)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={placeholder ?? t("composer.placeholder")}
            maxRows={8}
            aria-describedby={c.error ? `${id}-status` : undefined}
            className="px-3 pt-2.5 pb-1"
          />
          <div className="flex flex-wrap items-center gap-2 px-2 pt-1 pb-2">
            {settings && (
              <>
                <ModelSelect
                  models={models}
                  value={c.model}
                  onChange={c.changeModel}
                  provider={c.provider}
                  label={t("composer.model")}
                  className="w-48"
                />
                <ModeSelect
                  value={c.mode}
                  onChange={c.changeMode}
                  provider={c.provider}
                  allowBypass={false}
                  label={t("composer.mode")}
                  className="w-44"
                />
              </>
            )}
            <span aria-live="polite" className="min-w-0 flex-1 truncate px-1 text-xs text-ink-2">
              {c.sending ? t("composer.sending") : ""}
            </span>
            <span className="text-xs text-ink-3">{t("composer.shortcut", { key: MOD_KEY })}</span>
            <Button type="submit" variant="primary" aria-busy={c.sending}>
              <ArrowUp size={15} aria-hidden="true" />
              {t("composer.send")}
            </Button>
          </div>
        </form>

        <div className="flex flex-none flex-col justify-end border-l border-hairline pb-[9px] pl-4">
          <Button
            onClick={c.interrupt}
            aria-busy={c.interrupting}
            title={t("composer.interruptHint")}
          >
            <Square size={13} aria-hidden="true" className="fill-current" />
            {c.interrupting ? t("composer.interrupting") : t("composer.interrupt")}
          </Button>
        </div>
      </div>
      {c.error && (
        <p id={`${id}-status`} role="alert" className="mt-2 text-xs text-error-ink">
          {c.error}
        </p>
      )}
      {settings && isFullAccess(c.provider, c.mode) && (
        <BypassWarning provider={c.provider} className="mt-2" />
      )}
    </div>
  );
}
