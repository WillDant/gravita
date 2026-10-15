import type { TerminalInfo } from "@gravita/protocol";
import { useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { describeError } from "@/shared/presenters/errors";
import { useTerminalControl } from "@/state/hooks";
import { START_SIZE } from "./TerminalView";

/**
 * Opens the user's shell and hands the new terminal to `onOpened`. `cwd` absent: the engine
 * opens it in the home folder. A failure comes back as `error`, ready to show.
 */
export function useOpenTerminal(onOpened: (terminal: TerminalInfo) => void) {
  const { spawn } = useTerminalControl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const open = async (cwd?: string) => {
    setBusy(true);
    setError(undefined);
    const r = await spawn({ ...(cwd ? { cwd } : {}), command: "shell", ...START_SIZE });
    setBusy(false);
    if (r.ok) onOpened(r.value);
    else setError(t("terminal.failed", { reason: describeError(r.error).text }));
  };
  return { open, busy, error };
}
