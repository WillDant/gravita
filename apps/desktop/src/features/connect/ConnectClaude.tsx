import { Check, Copy, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@/shared/i18n/i18n";
import type { ClaudeProblem } from "@/shared/presenters/errors";
import { cn } from "@/shared/utils";

const INSTALL = "npm install -g @anthropic-ai/claude-code";

const STEPS: Record<ClaudeProblem, { label: string; command: string }[]> = {
  missing: [
    { label: "connect.step.install", command: INSTALL },
    { label: "connect.step.run", command: "claude" },
    { label: "connect.step.login", command: "/login" },
  ],
  outdated: [{ label: "connect.step.update", command: "claude update" }],
  loggedOut: [
    { label: "connect.step.run", command: "claude" },
    { label: "connect.step.login", command: "/login" },
  ],
};

/**
 * Calm guidance when Claude Code is missing, outdated or logged out. Gravita never logs
 * anyone in: the steps send the user to Claude Code in their own Terminal.
 */
export function ConnectClaude({
  problem,
  className,
}: {
  problem: ClaudeProblem;
  className?: string;
}) {
  return (
    <section
      aria-labelledby="connect-claude"
      className={cn("rounded-xl border border-hairline bg-panel px-4 py-3.5", className)}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-lg bg-ground text-ink ring-1 ring-hairline">
          <Terminal size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="connect-claude" className="text-sm font-semibold text-ink">
            {t(`connect.${problem}.title`)}
          </h2>
          <p className="mt-0.5 max-w-[68ch] text-sm text-ink-2">{t(`connect.${problem}.body`)}</p>
          <ol className="mt-3 flex flex-col gap-2">
            {STEPS[problem].map((step, i) => (
              <li key={step.command} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-56 max-w-full text-xs text-ink-2">
                  <span className="tabular-nums text-ink-3">{i + 1}.</span> {t(step.label)}
                </span>
                <CopyCommand command={step.command} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = () => {
    navigator.clipboard?.writeText(command).then(
      () => setCopied(true),
      () => {},
    );
  };

  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-hairline bg-ground py-0.5 pr-0.5 pl-2">
      <code className="truncate font-mono text-xs text-ink">{command}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={t("connect.copy", { command })}
        className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-ink-3 transition-colors hover:bg-panel hover:text-ink"
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        <span aria-live="polite">{copied ? t("connect.copied") : ""}</span>
      </button>
    </span>
  );
}
