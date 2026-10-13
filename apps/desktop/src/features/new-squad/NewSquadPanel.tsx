import type { ModelChoice } from "@gravita/core";
import type { SquadAutonomy } from "@gravita/protocol";
import { FolderOpen, UsersRound, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { usePickFolder } from "@/app/providers";
import { ConnectClaude } from "@/features/connect/ConnectClaude";
import { t } from "@/shared/i18n/i18n";
import { AutoTextarea, fieldFrame } from "@/shared/ui/form";
import { Button } from "@/shared/ui/ui";
import { cn, isSendChord, MOD_KEY } from "@/shared/utils";
import { useClaudeProblem } from "@/state/hooks";
import { useNewSquad } from "./useNewSquad";

const AUTONOMY: readonly SquadAutonomy[] = ["ask", "guarded", "auto"];
/** The policy first (recommended), then one model for everything. */
const MODEL_OPTIONS: readonly ModelChoice[] = ["auto", "opus", "sonnet"];

/** The header button that opens the inline new-squad panel. */
export function NewSquadButton({
  open,
  onToggle,
  controls,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <Button
      variant="secondary"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(open && "bg-panel")}
    >
      <UsersRound size={15} aria-hidden="true" />
      {t("newSquad.open")}
    </Button>
  );
}

/**
 * Starts a squad inline, under the page header: the folder, the goal in the user's own
 * words, a budget, how much the squad may do without asking, and how it picks models. On
 * success it opens the squad, where the planner picks up the conversation.
 */
export function NewSquadPanel({
  id,
  defaultFolder,
  onClose,
}: {
  id: string;
  defaultFolder?: string;
  onClose: () => void;
}) {
  const form = useNewSquad(defaultFolder);
  const statusProblem = useClaudeProblem();
  const pickFolder = usePickFolder();
  const fid = useId();
  const folderRef = useRef<HTMLInputElement>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const budgetRef = useRef<HTMLInputElement>(null);
  const problem = form.error?.claude ?? statusProblem;

  // biome-ignore lint/correctness/useExhaustiveDependencies: only on open.
  useEffect(() => {
    (defaultFolder ? goalRef : folderRef).current?.focus();
  }, []);

  useEffect(() => {
    if (form.invalid === "folder") folderRef.current?.focus();
    if (form.invalid === "goal") goalRef.current?.focus();
    if (form.invalid === "budget") budgetRef.current?.focus();
  }, [form.invalid]);

  const choose = () => {
    pickFolder?.().then(
      (path) => {
        if (path) form.setFolder(path);
      },
      () => {},
    );
  };

  return (
    <section
      id={id}
      aria-labelledby={`${fid}-title`}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="reveal rounded-xl border border-hairline bg-ground"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          form.submit();
        }}
        className="flex flex-col gap-4 px-5 pt-4 pb-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={`${fid}-title`} className="text-md font-semibold">
              {t("newSquad.title")}
            </h2>
            <p className="mt-0.5 max-w-[68ch] text-sm text-ink-2">{t("newSquad.intro")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("newSession.cancel")}
            className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-panel hover:text-ink"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {problem && <ConnectClaude problem={problem} />}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${fid}-folder`} className="text-xs font-semibold text-ink-2">
            {t("newSession.folder")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className={cn(fieldFrame, "min-w-[240px] flex-1")}>
              <input
                ref={folderRef}
                id={`${fid}-folder`}
                value={form.folder}
                onChange={(e) => form.setFolder(e.target.value)}
                placeholder={t("newSession.folderPlaceholder")}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={form.invalid === "folder"}
                aria-describedby={`${fid}-folder-hint`}
                className="h-8 w-full bg-transparent px-2.5 font-mono text-xs text-ink outline-none focus-visible:outline-none placeholder:font-sans placeholder:text-sm placeholder:text-ink-3"
              />
            </div>
            {pickFolder && (
              <Button onClick={choose}>
                <FolderOpen size={15} aria-hidden="true" />
                {t("newSession.chooseFolder")}
              </Button>
            )}
          </div>
          <p
            id={`${fid}-folder-hint`}
            className={cn("text-xs", form.invalid === "folder" ? "text-error-ink" : "text-ink-3")}
          >
            {form.invalid === "folder" ? t("newSquad.needFolder") : t("newSquad.folderHint")}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${fid}-goal`} className="text-xs font-semibold text-ink-2">
            {t("newSquad.goal")}
          </label>
          <div className={cn(fieldFrame, "px-3 py-2")}>
            <AutoTextarea
              ref={goalRef}
              id={`${fid}-goal`}
              value={form.goal}
              onChange={(e) => form.setGoal(e.target.value)}
              onKeyDown={(e) => {
                if (isSendChord(e)) {
                  e.preventDefault();
                  form.submit();
                }
              }}
              placeholder={t("newSquad.goalPlaceholder")}
              maxRows={10}
              aria-invalid={form.invalid === "goal"}
              className="min-h-[72px]"
            />
          </div>
          {form.invalid === "goal" && (
            <p className="text-xs text-error-ink">{t("newSquad.needGoal")}</p>
          )}
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-semibold text-ink-2">
            {t("newSquad.autonomy")}
          </legend>
          <div className="grid grid-cols-3 gap-0.5 rounded-xl bg-panel p-0.5 max-[760px]:grid-cols-1">
            {AUTONOMY.map((a) => (
              <label
                key={a}
                className={cn(
                  "flex cursor-pointer flex-col gap-0.5 rounded-[10px] px-3 py-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
                  form.autonomy === a ? "bg-ground shadow-panel" : "hover:bg-panel-2",
                )}
              >
                <input
                  type="radio"
                  name={`${fid}-autonomy`}
                  value={a}
                  checked={form.autonomy === a}
                  onChange={() => form.setAutonomy(a)}
                  className="sr-only"
                />
                <span className="text-sm font-semibold text-ink">
                  {t(`newSquad.autonomy.${a}`)}
                  {a === "guarded" && (
                    <span className="ml-1.5 text-xs font-medium text-ink-3">
                      {t("newSquad.recommended")}
                    </span>
                  )}
                </span>
                <span className="text-xs text-ink-2">{t(`newSquad.autonomy.${a}.hint`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${fid}-budget`} className="text-xs font-semibold text-ink-2">
              {t("newSquad.budget")}
            </label>
            <div className={cn(fieldFrame, "flex w-36 items-center pl-2.5")}>
              <span aria-hidden="true" className="tabular text-sm text-ink-3">
                $
              </span>
              <input
                ref={budgetRef}
                id={`${fid}-budget`}
                inputMode="decimal"
                value={form.budget}
                onChange={(e) => form.setBudget(e.target.value)}
                aria-invalid={form.invalid === "budget"}
                aria-describedby={`${fid}-budget-hint`}
                className="tabular h-8 w-full bg-transparent pr-2.5 pl-1 text-sm text-ink outline-none focus-visible:outline-none"
              />
            </div>
            <p
              id={`${fid}-budget-hint`}
              className={cn(
                "max-w-[26ch] text-xs",
                form.invalid === "budget" ? "text-error-ink" : "text-ink-3",
              )}
            >
              {form.invalid === "budget" ? t("newSquad.needBudget") : t("newSquad.budgetHint")}
            </p>
          </div>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-semibold text-ink-2">
            {t("newSquad.models")}
          </legend>
          <div className="grid grid-cols-3 gap-0.5 rounded-xl bg-panel p-0.5 max-[760px]:grid-cols-1">
            {MODEL_OPTIONS.map((m) => (
              <label
                key={m}
                className={cn(
                  "flex cursor-pointer flex-col gap-0.5 rounded-[10px] px-3 py-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
                  form.models === m ? "bg-ground shadow-panel" : "hover:bg-panel-2",
                )}
              >
                <input
                  type="radio"
                  name={`${fid}-models`}
                  value={m}
                  checked={form.models === m}
                  onChange={() => form.setModels(m)}
                  className="sr-only"
                />
                <span className="text-sm font-semibold text-ink">
                  {t(`newSquad.models.${m}`)}
                  {m === "auto" && (
                    <span className="ml-1.5 text-xs font-medium text-ink-3">
                      {t("newSquad.recommended")}
                    </span>
                  )}
                </span>
                <span className="text-xs text-ink-2">{t(`newSquad.models.${m}.hint`)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-hairline pt-4">
          {form.error && (
            <p role="alert" className="mr-auto max-w-[60ch] text-sm text-error-ink">
              {form.error.text}
            </p>
          )}
          <span className="text-xs text-ink-3">{t("newSquad.shortcut", { key: MOD_KEY })}</span>
          <Button variant="ghost" onClick={onClose}>
            {t("newSession.cancel")}
          </Button>
          <Button type="submit" variant="primary" aria-busy={form.busy}>
            {form.busy ? t("newSquad.starting") : t("newSquad.start")}
          </Button>
        </div>
      </form>
    </section>
  );
}
