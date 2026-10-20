import { activityOf, type SessionState } from "@gravita/core";
import { MAIN_AGENT } from "@gravita/protocol/ids";
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
import { cn, isComposerSend } from "@/shared/utils";
import { useModels, useNow } from "@/state/hooks";
import { useComposer } from "./useComposer";

/**
 * Talk to a session Gravita runs: one card with the message box on top (return sends,
 * shift-return breaks the line) and a quiet toolbar under it (model, permissions, send).
 * While the agents work, the send button turns into interrupt in the same spot.
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
  const now = useNow();
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const main = session.agents[MAIN_AGENT];
  const working =
    session.presence === "busy" || (main ? activityOf(main, session, now) !== undefined : false);
  const ready = c.text.trim().length > 0;

  const send = () => {
    if (!ready) {
      box.current?.focus();
      return;
    }
    c.send();
  };

  return (
    <div className="flex-none bg-ground px-6 pt-2 pb-4">
      <div className="mx-auto max-w-[760px]">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className={cn(fieldFrame, "flex min-w-0 flex-col rounded-xl bg-panel")}
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
              if (isComposerSend(e)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={placeholder ?? t("composer.placeholder")}
            maxRows={8}
            aria-describedby={c.error ? `${id}-status` : `${id}-hint`}
            className="min-h-[60px] px-4 pt-3 pb-1"
          />
          <div className="flex items-center gap-1 px-2 pt-1 pb-2">
            {settings && (
              <>
                <ModelSelect
                  models={models}
                  value={c.model}
                  onChange={c.changeModel}
                  provider={c.provider}
                  label={t("composer.model")}
                  variant="ghost"
                  className="max-w-44"
                />
                <ModeSelect
                  value={c.mode}
                  onChange={c.changeMode}
                  provider={c.provider}
                  allowBypass={false}
                  label={t("composer.mode")}
                  variant="ghost"
                  className="max-w-44"
                />
              </>
            )}
            <span aria-live="polite" className="min-w-0 flex-1 truncate px-1 text-xs text-ink-2">
              {c.sending ? t("composer.sending") : ""}
            </span>
            <span id={`${id}-hint`} className="hidden px-1 text-2xs text-ink-3 sm:inline">
              {t("composer.shortcut")}
            </span>
            {working ? (
              <button
                key="interrupt"
                type="button"
                onClick={c.interrupt}
                aria-label={c.interrupting ? t("composer.interrupting") : t("composer.interrupt")}
                title={t("composer.interruptHint")}
                aria-busy={c.interrupting}
                className={cn(
                  "inline-flex size-8 flex-none items-center justify-center rounded-lg border border-ink bg-ink text-ground transition-colors hover:bg-ink/85",
                  c.interrupting && "opacity-60",
                )}
              >
                <Square size={12} aria-hidden="true" className="fill-current" />
              </button>
            ) : (
              <button
                key="send"
                type="submit"
                aria-label={t("composer.send")}
                title={t("composer.send")}
                aria-busy={c.sending}
                className={cn(
                  "inline-flex size-8 flex-none items-center justify-center rounded-lg border transition-colors",
                  ready
                    ? "border-ink bg-ink text-ground hover:bg-ink/85"
                    : "border-hairline-strong text-ink-3 hover:bg-panel-2 hover:text-ink",
                )}
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </form>
      </div>
      {(c.error || (settings && isFullAccess(c.provider, c.mode))) && (
        <div className="mx-auto max-w-[760px]">
          {c.error && (
            <p id={`${id}-status`} role="alert" className="mt-2 text-xs text-error-ink">
              {c.error}
            </p>
          )}
          {settings && isFullAccess(c.provider, c.mode) && (
            <BypassWarning provider={c.provider} className="mt-2" />
          )}
        </div>
      )}
    </div>
  );
}
