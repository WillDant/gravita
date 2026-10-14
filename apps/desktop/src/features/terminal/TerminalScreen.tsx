import { useEffect } from "react";
import { useNavigate } from "@/app/providers";
import { Workspace } from "@/features/session/Session";
import { t, useLocale } from "@/shared/i18n/i18n";
import { useProjection, useTerminal } from "@/state/hooks";

/**
 * A terminal that runs no session yet (a shell, or Codex before its first message). Once a
 * session starts in it, its session's screen takes over.
 */
export function TerminalScreen({
  projectId,
  terminalId,
}: {
  projectId: string;
  terminalId: string;
}) {
  useLocale();
  const terminal = useTerminal(terminalId);
  const project = useProjection((p) => p.projects[projectId]);
  const navigate = useNavigate();
  const sessionId = terminal?.sessionId;

  useEffect(() => {
    if (sessionId) navigate({ level: "session", projectId, sessionId });
  }, [sessionId, projectId, navigate]);

  if (!terminal) {
    return (
      <p role="status" className="p-8 text-ink-2">
        {t("terminal.attachFailed")}
      </p>
    );
  }
  return <Workspace projectId={projectId} terminal={terminal} {...(project ? { project } : {})} />;
}
