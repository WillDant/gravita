import { AGENT_PROVIDERS, type AgentProvider } from "@gravita/protocol/constants";
import { Plus, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { ConnectProvider } from "@/features/connect/ConnectProvider";
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
import {
  useIsDemo,
  useModels,
  useProviderProblem,
  useTerminalSupported,
} from "@/state/hooks";
import { FolderField, type RecentFolder } from "./FolderField";
import { type RunIn, useNewSession } from "./useNewSession";

const RUN_IN: readonly RunIn[] = ["terminal", "chat"];

export type { RecentFolder };

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
 * Starts a session inline, under the page header (not a modal): agent, folder, first message,
 * model and permissions. On success it opens the new session.
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
  const isDemo = useIsDemo();
  const canTerminal = useTerminalSupported() && form.provider !== "cursor";
  const models = useModels(form.provider);
  const statusProblem = useProviderProblem(form.provider);
  const fieldId = useId();
  const folderRef = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const providerBlocked = statusProblem !== undefined;
  // An error names its provider; otherwise the chosen agent's status.
  const connect =
    form.error?.connect ?? (statusProblem && { provider: form.provider, problem: statusProblem });

  const disabledProviders: readonly AgentProvider[] = isDemo ? ["codex", "cursor"] : [];

  // Land where the typing starts: the message when the folder is known.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on open.
  useEffect(() => {
    if (defaultFolder) messageRef.current?.focus();
    else folderRef.current?.focus();
  }, []);

  useEffect(() => {
    if (form.missing === "folder") folderRef.current?.focus();
    if (form.missing === "message") messageRef.current?.focus();
  }, [form.missing]);

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

        <ProviderChoice
          name={`${fieldId}-provider`}
          providers={AGENT_PROVIDERS}
          disabled={disabledProviders}
          value={form.provider}
          onChange={form.setProvider}
        />

        {connect && <ConnectProvider provider={connect.provider} problem={connect.problem} />}

        <FolderField
          idPrefix={fieldId}
          folder={form.folder}
          onFolder={form.setFolder}
          invalid={form.missing === "folder"}
          errorText={form.missing === "folder" ? t("newSession.needFolder") : undefined}
          recent={recent}
          focusRef={folderRef}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${fieldId}-message`} className="text-xs font-semibold text-ink-2">
            {form.runIn === "terminal" ? t("newSession.messageOptional") : t("newSession.message")}
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
          {canTerminal && (
            <Segmented
              name={`${fieldId}-run-in`}
              legend={t("newSession.runIn")}
              options={RUN_IN.map((v) => ({ value: v, label: t(`newSession.runIn.${v}`) }))}
              value={form.runIn}
              onChange={form.setRunIn}
            />
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${fieldId}-model`} className="text-xs font-semibold text-ink-2">
              {t("newSession.model")}
            </label>
            <ModelSelect
              id={`${fieldId}-model`}
              models={models}
              value={form.model}
              onChange={form.setModel}
              provider={form.provider}
              withDefault={form.provider !== "cursor"}
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
              provider={form.provider}
              allowBypass
              className="w-52"
            />
          </div>
        </div>
        {isFullAccess(form.provider, form.mode) && <BypassWarning provider={form.provider} />}

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
          <Button
            type="submit"
            variant="primary"
            aria-busy={form.busy}
            disabled={providerBlocked}
          >
            {form.busy ? t("newSession.starting") : t("newSession.start")}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Which agent runs the session. */
function ProviderChoice({
  name,
  providers,
  disabled = [],
  value,
  onChange,
}: {
  name: string;
  providers: readonly AgentProvider[];
  disabled?: readonly AgentProvider[];
  value: AgentProvider;
  onChange: (provider: AgentProvider) => void;
}) {
  const blocked = new Set(disabled);
  return (
    <Segmented
      name={name}
      legend={t("newSession.provider")}
      options={providers.map((p) => ({
        value: p,
        label: t(`newSession.provider.${p}`),
        disabled: blocked.has(p),
      }))}
      value={value}
      onChange={onChange}
    />
  );
}

/**
 * One choice among a few, as a small segmented control: native radios (arrow keys move
 * between them), the chosen one a lifted ground tile, as the lens tabs.
 */
function Segmented<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs font-semibold text-ink-2">{legend}</legend>
      <div className="inline-flex h-8 gap-0.5 rounded-lg bg-panel p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex items-center rounded-md px-3 text-sm font-medium transition-colors motion-reduce:transition-none has-focus-visible:outline-2 has-focus-visible:outline-focus",
              o.disabled
                ? "cursor-not-allowed text-ink-3 opacity-50"
                : "cursor-pointer text-ink-2 hover:text-ink",
              !o.disabled && value === o.value && "bg-ground text-ink shadow-panel",
              !o.disabled && value !== o.value && "text-ink-2",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
