import type { TerminalInfo } from "@gravita/protocol";
import { SquareTerminal } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "@/app/providers";
import { t } from "@/shared/i18n/i18n";
import { Button } from "@/shared/ui/ui";
import { tildify } from "@/shared/utils";
import { useAppStore, useTerminalSupported } from "@/state/hooks";
import { useOpenTerminal } from "./useOpenTerminal";

/** Opens the user's shell in the project's folder, on a screen of its own. */
export function OpenTerminalButton({ projectId, cwd }: { projectId: string; cwd: string }) {
  const supported = useTerminalSupported();
  const navigate = useNavigate();
  const { open, busy, error } = useOpenTerminal((terminal) =>
    navigate({ level: "terminal", projectId, terminalId: terminal.terminalId }),
  );
  if (!supported) return null;
  return (
    <>
      <Button aria-busy={busy} onClick={() => void open(cwd)}>
        <SquareTerminal size={15} aria-hidden="true" />
        {t("terminal.open")}
      </Button>
      {error && (
        <p role="alert" className="w-full text-right text-xs text-error-ink">
          {error}
        </p>
      )}
    </>
  );
}

/** The project's terminals that run no session yet (the others show as their sessions). */
export function TerminalList({ projectId }: { projectId: string }) {
  const all = useAppStore((s) => s.terminals);
  const navigate = useNavigate();
  const open = useMemo(
    () =>
      Object.values(all)
        .filter((term) => term.projectId === projectId && !term.sessionId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [all, projectId],
  );
  if (open.length === 0) return null;
  return (
    <section aria-labelledby="terminals" className="flex flex-col gap-2">
      <h2 id="terminals" className="text-sm font-semibold">
        {t("terminal.list")}
      </h2>
      <ul className="flex flex-col">
        {open.map((term) => (
          <li key={term.terminalId}>
            <TerminalRow
              terminal={term}
              onOpen={() => navigate({ level: "terminal", projectId, terminalId: term.terminalId })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TerminalRow({ terminal, onOpen }: { terminal: TerminalInfo; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-panel"
    >
      <SquareTerminal size={15} aria-hidden="true" className="flex-none text-ink-3" />
      <span className="font-medium">{t(`terminal.title.${terminal.command}`)}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">
        {tildify(terminal.cwd)}
      </span>
      {!terminal.running && <span className="text-xs text-ink-3">{t("terminal.ended")}</span>}
    </button>
  );
}
