import type { TerminalInfo } from "@gravita/protocol";
import { RotateCcw, SquareTerminal, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { describeError } from "@/shared/presenters/errors";
import { Button } from "@/shared/ui/ui";
import { tildify } from "@/shared/utils";
import { useTerminalControl } from "@/state/hooks";

// xterm and its stylesheet load with the first terminal, off the initial bundle.
const TerminalPane = lazy(() => import("./TerminalPane"));

/** A size to start with; the pane fits the terminal to its box as soon as it mounts. */
export const START_SIZE = { cols: 100, rows: 30 } as const;

const CONFIRM_MS = 4_000;

/**
 * A terminal with its title bar (what runs, where, close) and, once its process ended, a
 * band to start it again (or resume its session).
 */
export function TerminalView({
  terminal,
  onReplaced,
  onClosed,
}: {
  terminal: TerminalInfo;
  /** A new terminal took this one's place (restart or resume). */
  onReplaced?: (next: TerminalInfo) => void;
  onClosed?: () => void;
}) {
  const { spawn, kill } = useTerminalControl();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  const again = async (resume: boolean) => {
    setBusy(true);
    setError(undefined);
    const r = await spawn({
      cwd: terminal.cwd,
      command: terminal.command,
      ...START_SIZE,
      ...(resume && terminal.sessionId ? { resume: terminal.sessionId } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setError(t("terminal.failed", { reason: describeError(r.error).text }));
      return;
    }
    void kill(terminal.terminalId);
    onReplaced?.(r.value);
  };

  const close = async () => {
    if (terminal.running && !confirming) {
      setConfirming(true);
      return;
    }
    await kill(terminal.terminalId);
    onClosed?.();
  };

  const resumable = terminal.command !== "shell" && Boolean(terminal.sessionId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-hairline px-4 py-1.5 text-xs">
        <SquareTerminal size={14} aria-hidden="true" className="flex-none text-ink-3" />
        <span className="font-semibold text-ink">{t(`terminal.title.${terminal.command}`)}</span>
        <span className="min-w-0 truncate font-mono text-ink-3" title={terminal.cwd}>
          {tildify(terminal.cwd)}
        </span>
        <button
          type="button"
          onClick={() => void close()}
          aria-label={confirming ? t("terminal.closeConfirm") : t("terminal.close")}
          title={t("terminal.close")}
          className={
            confirming
              ? "ml-auto inline-flex h-6 flex-none items-center gap-1 rounded-md bg-error-bg px-2 font-medium text-error-ink"
              : "ml-auto inline-flex size-6 flex-none items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-panel hover:text-ink"
          }
        >
          <X size={14} aria-hidden="true" />
          {confirming && t("terminal.close")}
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <Suspense fallback={<div className="h-full bg-[#0f1115]" />}>
          <TerminalPane terminalId={terminal.terminalId} />
        </Suspense>
      </div>
      {!terminal.running && (
        <div
          role="status"
          className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline bg-panel px-4 py-2 text-sm text-ink-2"
        >
          <span className="min-w-0 flex-1">
            {terminal.exitCode === null || terminal.exitCode === undefined
              ? t("terminal.stopped")
              : t("terminal.exited", { code: String(terminal.exitCode) })}
          </span>
          {resumable && (
            <Button variant="primary" aria-busy={busy} onClick={() => void again(true)}>
              <RotateCcw size={14} aria-hidden="true" />
              {t("terminal.resume")}
            </Button>
          )}
          <Button aria-busy={busy} onClick={() => void again(false)}>
            {t("terminal.restart")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="flex-none px-4 py-2 text-xs text-error-ink">
          {error}
        </p>
      )}
    </div>
  );
}
