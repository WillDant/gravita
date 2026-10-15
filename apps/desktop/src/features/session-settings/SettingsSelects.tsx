import type { PermissionMode, SessionMode } from "@gravita/protocol";
import { type AgentProvider, CODEX_MODES, CURSOR_MODES } from "@gravita/protocol/constants";
import { TriangleAlert } from "lucide-react";
import { t } from "@/shared/i18n/i18n";
import { Select } from "@/shared/ui/form";
import { cn } from "@/shared/utils";
import type { ModelOption } from "@/state/slices/control";

export const PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];

/** Each provider's modes, in the order its select lists them, and their copy. */
const PROVIDER_MODES: Readonly<
  Record<
    AgentProvider,
    {
      modes: readonly SessionMode[];
      /**
       * The mode that acts without asking: only chosen when a session starts. Cursor has
       * none, Gravita never runs it with `--force`.
       */
      fullAccess?: SessionMode;
      label: (mode: SessionMode) => string;
      warning?: string;
    }
  >
> = {
  claude: {
    modes: PERMISSION_MODES,
    fullAccess: "bypassPermissions",
    label: (m) => `mode.${m}`,
    warning: "mode.bypassWarning",
  },
  codex: {
    modes: CODEX_MODES,
    fullAccess: "fullAccess",
    label: (m) => `mode.codex.${m}`,
    warning: "mode.codex.fullAccessWarning",
  },
  cursor: {
    modes: CURSOR_MODES,
    label: (m) => `mode.cursor.${m}`,
  },
};

/** Whether `mode` lets `provider`'s agent act without asking (Claude's bypass, Codex's full access). */
export function isFullAccess(provider: AgentProvider, mode: SessionMode): boolean {
  const { fullAccess } = PROVIDER_MODES[provider];
  return fullAccess !== undefined && fullAccess === mode;
}

const MODEL_DEFAULT: Readonly<Record<AgentProvider, string>> = {
  claude: "newSession.modelDefault",
  codex: "newSession.modelDefaultCodex",
  cursor: "newSession.modelDefaultCursor",
};

/**
 * A provider's models (Claude Code's by default). `value` "" is the provider's default
 * (always offered with `withDefault`, else only while nothing is set); an unlisted model
 * shows as itself.
 */
export function ModelSelect({
  models,
  value,
  onChange,
  provider = "claude",
  withDefault,
  id,
  label,
  className,
  variant,
}: {
  models: ModelOption[];
  value: string;
  onChange: (model: string) => void;
  provider?: AgentProvider;
  withDefault?: boolean;
  id?: string;
  label?: string;
  className?: string;
  variant?: "field" | "ghost";
}) {
  const known = value === "" || models.some((m) => m.value === value);
  const showDefaultOption =
    provider !== "cursor" && (withDefault === true || (withDefault !== false && value === ""));
  return (
    <Select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      variant={variant}
    >
      {showDefaultOption && <option value="">{t(MODEL_DEFAULT[provider])}</option>}
      {!known && <option value={value}>{value}</option>}
      {models.map((m) => (
        <option key={m.value} value={m.value}>
          {m.displayName}
        </option>
      ))}
    </Select>
  );
}

/** A provider's session modes (Claude Code's permission modes by default). */
export function ModeSelect({
  value,
  onChange,
  provider = "claude",
  allowBypass,
  id,
  label,
  className,
  variant,
}: {
  value: SessionMode;
  onChange: (mode: SessionMode) => void;
  provider?: AgentProvider;
  /**
   * The full-access mode (Claude's bypass, Codex's full access) can only be chosen when a
   * session starts (the engine refuses switching to it later), so mid-session selects offer
   * it only if the session already runs in it.
   */
  allowBypass: boolean;
  id?: string;
  label?: string;
  className?: string;
  variant?: "field" | "ghost";
}) {
  const { modes, fullAccess, label: copy } = PROVIDER_MODES[provider];
  const offered = modes.filter((m) => m !== fullAccess || allowBypass || value === fullAccess);
  return (
    <Select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as SessionMode)}
      className={className}
      variant={variant}
    >
      {offered.map((m) => (
        <option key={m} value={m}>
          {t(copy(m))}
        </option>
      ))}
    </Select>
  );
}

/** Said plainly whenever the full-access mode is chosen: the agent acts without asking. */
export function BypassWarning({
  provider = "claude",
  className,
}: {
  provider?: AgentProvider;
  className?: string;
}) {
  const warning = PROVIDER_MODES[provider].warning;
  if (!warning) return null;
  return (
    <p role="note" className={cn("flex items-start gap-1.5 text-xs text-error-ink", className)}>
      <TriangleAlert size={13} className="mt-px flex-none" aria-hidden="true" />
      {t(warning)}
    </p>
  );
}
