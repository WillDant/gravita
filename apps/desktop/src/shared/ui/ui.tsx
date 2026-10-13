import type { SessionCounts } from "@gravita/core";
import { agentColor, lineCode } from "@gravita/orbs";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { t } from "@/shared/i18n/i18n";
import type { SessionStatus } from "@/shared/presenters/selectors";
import { cn } from "@/shared/utils";

/** A metro line code: coloured disc, one or two letters. */
export function LineBadge({
  agentType,
  size = 18,
  dim,
  code,
  title,
}: {
  agentType: string;
  size?: number;
  dim?: boolean;
  /** The disc's letters when they don't follow from the colour key (a custom squad role). */
  code?: string;
  title?: string;
}) {
  const c = agentColor(agentType);
  return (
    <span
      title={title ?? (agentType === "main" ? t("agent.main") : agentType)}
      className={cn(
        "inline-flex flex-none items-center justify-center rounded-full font-bold leading-none",
        dim && "opacity-40",
      )}
      style={{
        width: size,
        height: size,
        background: c.badge,
        color: c.badgeText,
        fontSize: size * 0.55,
      }}
    >
      {code ?? lineCode(agentType)}
    </span>
  );
}

/**
 * The same three counts on every screen. In a session, subagents are counted in total
 * with how many are active; across projects, only active subagents mean anything.
 */
export function CountChips({
  counts,
  scope = "overview",
  className,
}: {
  counts: SessionCounts;
  scope?: "session" | "overview";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <Chip tone={counts.running > 0 ? "live" : "quiet"}>
        {t("count.running", { count: counts.running })}
      </Chip>
      <Chip tone="quiet">
        {scope === "session"
          ? `${t("count.subagents", { count: counts.subagentsTotal })} · ${t("count.active", { count: counts.subagents })}`
          : t("count.subagentsActive", { count: counts.subagents })}
      </Chip>
      {counts.waiting > 0 && (
        <Chip tone="waiting">{t("count.waiting", { count: counts.waiting })}</Chip>
      )}
    </div>
  );
}

export function Chip({
  tone,
  children,
}: {
  tone: "live" | "quiet" | "waiting";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-medium tabular-nums",
        tone === "live" && "bg-ink text-ground",
        tone === "quiet" && "bg-panel text-ink-2",
        tone === "waiting" && "bg-waiting-bg text-waiting-ink",
      )}
    >
      {tone === "live" && <span className="size-1.5 rounded-full bg-ok" aria-hidden="true" />}
      {tone === "waiting" && (
        <span className="size-1.5 rounded-full bg-waiting" aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<SessionStatus, string> = {
  waiting: "text-waiting-ink",
  running: "text-ink",
  idle: "text-ink-2",
  done: "text-ink-3",
  error: "text-error-ink",
  detached: "text-ink-3",
};

const STATUS_DOT: Record<SessionStatus, string> = {
  waiting: "bg-waiting",
  running: "bg-ok",
  idle: "bg-ink-3",
  done: "border border-ink-3",
  error: "bg-error",
  detached: "border border-dashed border-ink-3",
};

export function StatusText({ status }: { status: SessionStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-medium", STATUS_TONE[status])}>
      <span
        className={cn("size-2 flex-none rounded-full", STATUS_DOT[status])}
        aria-hidden="true"
      />
      {t(`status.${status}`)}
    </span>
  );
}

export function Button({
  className,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors",
        variant === "primary" && "bg-ink text-ground hover:bg-ink/85",
        variant === "secondary" &&
          "border border-hairline-strong bg-ground text-ink hover:bg-panel",
        variant === "ghost" && "text-ink-2 hover:bg-panel hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}
