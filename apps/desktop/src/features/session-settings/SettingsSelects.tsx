import type { PermissionMode } from "@gravita/protocol";
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

/**
 * Claude Code's models. `value` "" is Claude Code's default (always offered with
 * `withDefault`, else only while nothing is set); an unlisted model shows as itself.
 */
export function ModelSelect({
  models,
  value,
  onChange,
  withDefault,
  id,
  label,
  className,
}: {
  models: ModelOption[];
  value: string;
  onChange: (model: string) => void;
  withDefault?: boolean;
  id?: string;
  label?: string;
  className?: string;
}) {
  const known = value === "" || models.some((m) => m.value === value);
  return (
    <Select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      {(withDefault || value === "") && <option value="">{t("newSession.modelDefault")}</option>}
      {!known && <option value={value}>{value}</option>}
      {models.map((m) => (
        <option key={m.value} value={m.value}>
          {m.displayName}
        </option>
      ))}
    </Select>
  );
}

export function ModeSelect({
  value,
  onChange,
  allowBypass,
  id,
  label,
  className,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void;
  /**
   * Bypass can only be chosen when a session starts (the engine refuses switching to it
   * later), so mid-session selects offer it only if the session already runs in bypass.
   */
  allowBypass: boolean;
  id?: string;
  label?: string;
  className?: string;
}) {
  const modes = PERMISSION_MODES.filter(
    (m) => m !== "bypassPermissions" || allowBypass || value === "bypassPermissions",
  );
  return (
    <Select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as PermissionMode)}
      className={className}
    >
      {modes.map((m) => (
        <option key={m} value={m}>
          {t(`mode.${m}`)}
        </option>
      ))}
    </Select>
  );
}

/** Said plainly whenever "don't ask" is chosen: the agent acts without asking. */
export function BypassWarning({ className }: { className?: string }) {
  return (
    <p role="note" className={cn("flex items-start gap-1.5 text-xs text-error-ink", className)}>
      <TriangleAlert size={13} className="mt-px flex-none" aria-hidden="true" />
      {t("mode.bypassWarning")}
    </p>
  );
}
