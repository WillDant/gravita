import { FolderOpen, Plus, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { usePickFolder } from "@/app/providers";
import { ConnectClaude } from "@/features/connect/ConnectClaude";
import {
  BypassWarning,
  ModelSelect,
  ModeSelect,
} from "@/features/session-settings/SettingsSelects";
import { t } from "@/shared/i18n/i18n";
import { AutoTextarea, fieldFrame } from "@/shared/ui/form";
import { Button } from "@/shared/ui/ui";
import { cn, isSendChord, MOD_KEY, tildify } from "@/shared/utils";
import { useClaudeProblem, useModels } from "@/state/hooks";
import { useNewSession } from "./useNewSession";

export interface RecentFolder {
  name: string;
  root: string;
}

/** The header button that opens the inline new-session panel. */
export function NewSessionButton({
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
      variant={open ? "secondary" : "primary"}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <Plus size={15} aria-hidden="true" />
      {t("newSession.open")}
    </Button>
  );
}

/**
 * Starts a Claude Code session inline, under the page header (not a modal): folder,
 * first message, model and permissions. On success it opens the new session.
 */
export function NewSessionPanel({
  id,
  defaultFolder,
  recent = [],
  onClose,
}: {
  id: string;
  defaultFolder?: string;
  recent?: RecentFolder[];
  onClose: () => void;
}) {
  const form = useNewSession(defaultFolder);
  const models = useModels();
  const statusProblem = useClaudeProblem();
  const pickFolder = usePickFolder();
  const fieldId = useId();
  const folderRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const problem = form.error?.claude ?? statusProblem;

  // Land where the typing starts: the message when the folder is known.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on open.
  useEffect(() => {
    (defaultFolder ? messageRef : folderRef).current?.focus();
  }, []);

  useEffect(() => {
    if (form.missing === "folder") folderRef.current?.focus();
    if (form.missing === "message") messageRef.current?.focus();
  }, [form.missing]);

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
      aria-labelledby={`${fieldId}-title`}
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
        <div className="flex items-center justify-between gap-4">
          <h2 id={`${fieldId}-title`} className="text-md font-semibold">
            {t("newSession.title")}
          </h2>
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
          <label htmlFor={`${fieldId}-folder`} className="text-xs font-semibold text-ink-2">
            {t("newSession.folder")}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <div className={cn(fieldFrame, "min-w-[260px] flex-1")}>
              <input
                ref={folderRef}
                id={`${fieldId}-folder`}
                value={form.folder}
                onChange={(e) => form.setFolder(e.target.value)}
                placeholder={t("newSession.folderPlaceholder")}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={form.missing === "folder"}
                aria-describedby={form.missing === "folder" ? `${fieldId}-folder-err` : undefined}
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
          {form.missing === "folder" && (
            <p id={`${fieldId}-folder-err`} className="text-xs text-error-ink">
              {t("newSession.needFolder")}
            </p>
          )}
          {recent.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-ink-3">{t("newSession.recent")}</span>
              {recent.map((r) => (
                <button
                  key={r.root}
                  type="button"
                  title={tildify(r.root)}
                  aria-pressed={form.folder === r.root}
                  onClick={() => form.setFolder(r.root)}
                  className={cn(
                    "h-6 max-w-[220px] truncate rounded-full px-2.5 text-xs font-medium transition-colors",
                    form.folder === r.root
                      ? "bg-ink text-ground"
                      : "bg-panel text-ink-2 hover:bg-panel-2 hover:text-ink",
                  )}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${fieldId}-message`} className="text-xs font-semibold text-ink-2">
            {t("newSession.message")}
          </label>
          <div className={cn(fieldFrame, "px-3 py-2")}>
            <AutoTextarea
              ref={messageRef}
              id={`${fieldId}-message`}
              value={form.message}
              onChange={(e) => form.setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (isSendChord(e)) {
                  e.preventDefault();
                  form.submit();
                }
              }}
              placeholder={t("newSession.messagePlaceholder")}
              maxRows={10}
              aria-invalid={form.missing === "message"}
              className="min-h-[60px]"
            />
          </div>
          {form.missing === "message" && (
            <p className="text-xs text-error-ink">{t("newSession.needMessage")}</p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${fieldId}-model`} className="text-xs font-semibold text-ink-2">
              {t("newSession.model")}
            </label>
            <ModelSelect
              id={`${fieldId}-model`}
              models={models}
              value={form.model}
              onChange={form.setModel}
              withDefault
              className="w-52"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${fieldId}-mode`} className="text-xs font-semibold text-ink-2">
              {t("newSession.mode")}
            </label>
            <ModeSelect
              id={`${fieldId}-mode`}
              value={form.mode}
              onChange={form.setMode}
              allowBypass
              className="w-52"
            />
          </div>
        </div>
        {form.mode === "bypassPermissions" && <BypassWarning />}

        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-hairline pt-4">
          {form.error && (
            <p role="alert" className="mr-auto max-w-[60ch] text-sm text-error-ink">
              {form.error.text}
            </p>
          )}
          <span className="text-xs text-ink-3">{t("newSession.shortcut", { key: MOD_KEY })}</span>
          <Button variant="ghost" onClick={onClose}>
            {t("newSession.cancel")}
          </Button>
          <Button type="submit" variant="primary" aria-busy={form.busy}>
            {form.busy ? t("newSession.starting") : t("newSession.start")}
          </Button>
        </div>
      </form>
    </section>
  );
}
