import type { CredentialState } from "@gravita/protocol/constants";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useId, useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { fieldFrame } from "@/shared/ui/form";
import { ProviderIcon } from "@/shared/ui/ProviderIcon";
import { Button } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { looksLikeKey, useCursorKey } from "./useCursorKey";

const STATE_TONE: Readonly<Record<CredentialState, string>> = {
  missing: "text-ink-3",
  unchecked: "text-ink-2",
  valid: "text-ok-ink",
  invalid: "text-error-ink",
};

/**
 * Where the Cursor API key is added, checked, replaced or removed. The key is typed into
 * an uncontrolled field and handed straight to the shell (macOS Keychain): it never sits
 * in React state, and once saved it is never shown again, only its state.
 */
export function CursorKey({ className }: { className?: string }) {
  const key = useCursorKey();
  const [replacing, setReplacing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [badFormat, setBadFormat] = useState(false);
  const fieldId = useId();
  const stored = key.state !== "missing";
  const editing = !stored || replacing;

  const submit = async (form: HTMLFormElement) => {
    const input = form.elements.namedItem("cursor-key") as HTMLInputElement | null;
    const value = input?.value.trim() ?? "";
    if (!looksLikeKey(value)) {
      setBadFormat(true);
      return;
    }
    setBadFormat(false);
    const saved = await key.save(value);
    form.reset();
    if (saved) setReplacing(false);
  };

  const remove = async () => {
    setConfirming(false);
    if (await key.remove()) setReplacing(false);
  };

  return (
    <section
      aria-labelledby={`${fieldId}-title`}
      className={cn("rounded-xl border border-hairline bg-panel px-4 py-3.5", className)}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-lg bg-ground text-ink ring-1 ring-hairline">
          <ProviderIcon provider="cursor" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${fieldId}-title`} className="text-sm font-semibold text-ink">
            {t("cursorKey.title")}
          </h2>
          <p className="mt-0.5 max-w-[68ch] text-sm text-ink-2">{t("cursorKey.body")}</p>
          <p
            className={cn("mt-2 flex items-center gap-1.5 text-sm font-medium", STATE_TONE[key.state])}
            aria-live="polite"
          >
            {key.state === "valid" && <CircleCheck size={15} aria-hidden="true" />}
            {key.state === "invalid" && <CircleAlert size={15} aria-hidden="true" />}
            {t(`cursorKey.state.${key.state}`)}
          </p>

          {!key.available ? (
            <p className="mt-2 text-sm text-ink-3">{t("cursorKey.desktopOnly")}</p>
          ) : (
            <>
              {editing && (
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void submit(e.currentTarget);
                  }}
                  className="mt-3 flex flex-wrap items-center gap-2"
                >
                  <label htmlFor={`${fieldId}-key`} className="sr-only">
                    {t("cursorKey.field")}
                  </label>
                  <div className={cn(fieldFrame, "min-w-[260px] flex-1")}>
                    <input
                      id={`${fieldId}-key`}
                      name="cursor-key"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t("cursorKey.placeholder")}
                      aria-invalid={badFormat}
                      className="h-8 w-full bg-transparent px-2.5 font-mono text-xs text-ink outline-none focus-visible:outline-none placeholder:font-sans placeholder:text-sm placeholder:text-ink-3"
                    />
                  </div>
                  <Button type="submit" variant="primary" aria-busy={key.busy === "save"}>
                    {key.busy === "save" ? t("cursorKey.saving") : t("cursorKey.save")}
                  </Button>
                  {replacing && (
                    <Button variant="ghost" onClick={() => setReplacing(false)}>
                      {t("cursorKey.cancel")}
                    </Button>
                  )}
                </form>
              )}
              {editing && <p className="mt-2 text-xs text-ink-3">{t("cursorKey.where")}</p>}

              {stored && !replacing && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button onClick={() => void key.validate()} aria-busy={key.busy === "validate"}>
                    {key.busy === "validate" ? t("cursorKey.validating") : t("cursorKey.validate")}
                  </Button>
                  <Button onClick={() => setReplacing(true)}>{t("cursorKey.replace")}</Button>
                  {confirming ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span className="text-sm text-ink-2">{t("cursorKey.removeConfirm")}</span>
                      <Button variant="primary" onClick={() => void remove()}>
                        {t("cursorKey.removeYes")}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(false)}>
                        {t("cursorKey.cancel")}
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirming(true)}>
                      {t("cursorKey.remove")}
                    </Button>
                  )}
                </div>
              )}

              {badFormat && (
                <p role="alert" className="mt-2 text-sm text-error-ink">
                  {t("cursorKey.badFormat")}
                </p>
              )}
              {key.failed && (
                <p role="alert" className="mt-2 text-sm text-error-ink">
                  {t(`cursorKey.failed.${key.failed}`)}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
