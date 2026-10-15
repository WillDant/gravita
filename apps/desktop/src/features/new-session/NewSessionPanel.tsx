import { AGENT_PROVIDERS, type AgentProvider } from "@gravita/protocol/constants";
import { Cpu, MessageSquare, Plus, ShieldCheck, SquareTerminal, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { ConnectProvider } from "@/features/connect/ConnectProvider";
import {
  BypassWarning,
  isFullAccess,
  ModelSelect,
  ModeSelect,
} from "@/features/session-settings/SettingsSelects";
import { t } from "@/shared/i18n/i18n";

import { FieldLabel } from "@/shared/ui/FieldLabel";
import { ProviderIcon } from "@/shared/ui/ProviderIcon";
import { Segmented } from "@/shared/ui/Segmented";
import { Button } from "@/shared/ui/ui";
import { useIsDemo, useModels, useProviderProblem, useTerminalSupported } from "@/state/hooks";
import { FolderField, type RecentFolder } from "./FolderField";
import { type RunIn, useNewSession } from "./useNewSession";

const RUN_IN: readonly RunIn[] = ["terminal", "chat"];
const RUN_IN_ICON: Readonly<Record<RunIn, ReactNode>> = {
  terminal: <SquareTerminal size={14} aria-hidden="true" />,
  chat: <MessageSquare size={14} aria-hidden="true" />,
};

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
 * Starts a session inline, under the page header (not a modal): agent, folder, where it runs,
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
  const canTerminal = useTerminalSupported();
  const models = useModels(form.provider);
  const statusProblem = useProviderProblem(form.provider);
  const fieldId = useId();
  const folderRef = useRef<HTMLButtonElement>(null);
  const providerBlocked = statusProblem !== undefined;
  // An error names its provider; otherwise the chosen agent's status.
  const connect =
    form.error?.connect ?? (statusProblem && { provider: form.provider, problem: statusProblem });

  const disabledProviders: readonly AgentProvider[] = isDemo ? ["codex", "cursor"] : [];

  // Land on the folder when it still has to be chosen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on open.
  useEffect(() => {
    if (!defaultFolder) folderRef.current?.focus();
  }, []);

  useEffect(() => {
    if (form.missing === "folder") folderRef.current?.focus();
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
          <h2 id={`${fieldId}-title`} className="flex items-center gap-2 text-md font-semibold">
            <MessageSquare size={16} aria-hidden="true" className="text-ink-3" />
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

        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          {canTerminal && (
            <Segmented
              name={`${fieldId}-run-in`}
              legend={t("newSession.runIn")}
              options={RUN_IN.map((v) => ({
                value: v,
                label: t(`newSession.runIn.${v}`),
                icon: RUN_IN_ICON[v],
              }))}
              value={form.runIn}
              onChange={form.setRunIn}
            />
          )}
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`${fieldId}-model`} icon={<Cpu size={13} />}>
              {t("newSession.model")}
            </FieldLabel>
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
            <FieldLabel htmlFor={`${fieldId}-mode`} icon={<ShieldCheck size={13} />}>
              {t("newSession.mode")}
            </FieldLabel>
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
          <Button variant="ghost" onClick={onClose}>
            {t("newSession.cancel")}
          </Button>
          <Button type="submit" variant="primary" aria-busy={form.busy} disabled={providerBlocked}>
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
        icon: <ProviderIcon provider={p} />,
        disabled: blocked.has(p),
      }))}
      value={value}
      onChange={onChange}
    />
  );
}
