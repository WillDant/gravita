import type { SquadProviderChoice } from "@gravita/protocol/constants";
import { Blend, ExternalLink, Users } from "lucide-react";
import { type RefObject, useState } from "react";
import { useOpenSignIn } from "@/app/providers";
import { t } from "@/shared/i18n/i18n";
import { describeError } from "@/shared/presenters/errors";
import { FieldLabel } from "@/shared/ui/FieldLabel";
import { ProviderIcon } from "@/shared/ui/ProviderIcon";
import { Button } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useAppStore, useCodexProfile, useCodexProfileRefresh } from "@/state/hooks";
import type { NewSquadForm } from "./useNewSquad";

/** Claude Code first (the default), then the two ways Codex joins. */
const CHOICES: readonly SquadProviderChoice[] = ["claude", "codex", "mixed"];

/**
 * Who builds the squad: Claude Code only, Codex only, or a mix the planner proposes per
 * role. Shown only when Codex can run here. A choice with Codex in it needs Gravita's own
 * Codex profile, so its status and the way to sign in to it sit right under the choice.
 */
export function ProvidersField({
  form,
  id,
  signInRef,
}: {
  form: NewSquadForm;
  id: string;
  signInRef: RefObject<HTMLButtonElement | null>;
}) {
  useCodexProfileRefresh(form.needsCodexProfile);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <FieldLabel as="legend" icon={<Users size={13} />} className="mb-1.5">
        {t("newSquad.providers")}
      </FieldLabel>
      <div className="grid grid-cols-3 gap-0.5 rounded-xl bg-panel p-0.5 max-[760px]:grid-cols-1">
        {CHOICES.map((p) => (
          <label
            key={p}
            className={cn(
              "flex cursor-pointer flex-col gap-0.5 rounded-[10px] px-3 py-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
              form.providers === p ? "bg-ground shadow-panel" : "hover:bg-panel-2",
            )}
          >
            <input
              type="radio"
              name={`${id}-providers`}
              value={p}
              checked={form.providers === p}
              onChange={() => form.setProviders(p)}
              className="sr-only"
            />
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              {p === "mixed" ? (
                <Blend size={14} aria-hidden="true" className="flex-none text-ink-3" />
              ) : (
                <ProviderIcon provider={p} size={14} className="text-ink-3" />
              )}
              {t(`newSquad.providers.${p}`)}
            </span>
            <span className="text-xs text-ink-2">{t(`newSquad.providers.${p}.hint`)}</span>
          </label>
        ))}
      </div>
      {form.needsCodexProfile && (
        <CodexProfileLine invalid={form.invalid === "providers"} buttonRef={signInRef} />
      )}
    </fieldset>
  );
}

/**
 * Gravita's Codex profile in one line: signed in (and on which plan), a sign-in waiting on
 * the browser, or why it is separate and the button that opens Codex's own sign-in page.
 */
export function CodexProfileLine({
  invalid,
  buttonRef,
}: {
  invalid?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const profile = useCodexProfile();
  const signIn = useAppStore((s) => s.signInCodexProfile);
  const openSignIn = useOpenSignIn();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const start = () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    void signIn().then(async (r) => {
      setBusy(false);
      if (!r.ok) return setError(describeError(r.error).text);
      try {
        await openSignIn(r.value.authUrl);
      } catch {
        setError(t("newSquad.codexProfile.openFailed"));
      }
    });
  };

  if (profile?.loggedIn)
    return (
      <p role="status" className="text-xs text-ink-2">
        {profile.planType
          ? t("newSquad.codexProfile.signedInPlan", { plan: profile.planType })
          : t("newSquad.codexProfile.signedIn")}
      </p>
    );

  const why = profile?.error ?? error;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5",
        invalid ? "border-waiting/40 bg-waiting-bg" : "border-hairline",
      )}
    >
      <p
        className={cn("min-w-[240px] flex-1 text-xs", invalid ? "text-waiting-ink" : "text-ink-2")}
      >
        {profile?.signingIn ? t("newSquad.codexProfile.waiting") : t("newSquad.codexProfile.why")}
      </p>
      <Button ref={buttonRef} onClick={start} aria-busy={busy}>
        <ExternalLink size={14} aria-hidden="true" />
        {profile?.signingIn ? t("newSquad.codexProfile.again") : t("newSquad.codexProfile.signIn")}
      </Button>
      {why && (
        <p role="alert" className="w-full text-xs text-error-ink">
          {why}
        </p>
      )}
    </div>
  );
}
