import { DEFAULT_MODE } from "@gravita/core";
import type { SessionMode } from "@gravita/protocol";
import { type AgentProvider, DEFAULT_PROVIDER } from "@gravita/protocol/constants";
import { useState } from "react";
import { useNavigate } from "@/app/providers";
import { START_SIZE } from "@/features/terminal/TerminalView";
import { describeError, type ErrorView } from "@/shared/presenters/errors";
import { useControl, useTerminalControl, useTerminalSupported } from "@/state/hooks";

export type MissingField = "folder";

/** Where the session runs: the agent's own CLI in a terminal here, or a chat Gravita drives. */
export type RunIn = "terminal" | "chat";

export interface NewSessionForm {
  folder: string;
  /** The agent the session runs: Claude Code unless Codex or Cursor is chosen. */
  provider: AgentProvider;
  /** "" means the provider's own default. */
  model: string;
  /** In the provider's own terms. */
  mode: SessionMode;
  /** Only offered when the engine can open terminals. */
  runIn: RunIn;
  setRunIn: (v: RunIn) => void;
  setFolder: (v: string) => void;
  /** Switches the agent, back to its default model and mode (models and modes are its own). */
  setProvider: (v: AgentProvider) => void;
  setModel: (v: string) => void;
  setMode: (v: SessionMode) => void;
  busy: boolean;
  /** The first required field left empty on the last attempt. */
  missing?: MissingField;
  error?: ErrorView;
  /** Validates, starts the session and opens it; errors stay on the form. */
  submit: () => void;
}

export function useNewSession(defaultFolder = ""): NewSessionForm {
  const { startSession } = useControl();
  const terminals = useTerminalControl();
  const canTerminal = useTerminalSupported();
  const [chosenRunIn, setRunIn] = useState<RunIn>("terminal");
  const navigate = useNavigate();
  const [folder, setFolder] = useState(defaultFolder);
  const [provider, setProvider] = useState<AgentProvider>(DEFAULT_PROVIDER);
  // A terminal is the first choice wherever the engine can open one.
  const runIn: RunIn = canTerminal ? chosenRunIn : "chat";
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<SessionMode>(DEFAULT_MODE[DEFAULT_PROVIDER]);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<MissingField>();
  const [error, setError] = useState<ErrorView>();

  const submit = () => {
    if (busy) return;
    const cwd = folder.trim();
    // Only the folder is needed: the user writes the first message in the session itself.
    const empty: MissingField | undefined = cwd ? undefined : "folder";
    setMissing(empty);
    setError(undefined);
    if (empty) return;
    setBusy(true);
    if (runIn === "terminal") {
      void terminals
        .spawn({
          cwd,
          command: provider,
          ...START_SIZE,
          permissionMode: mode,
          ...(model ? { model } : {}),
        })
        .then((r) => {
          setBusy(false);
          if (!r.ok) {
            setError(describeError(r.error));
            return;
          }
          const { projectId, sessionId, terminalId } = r.value;
          navigate(
            sessionId
              ? { level: "session", projectId, sessionId }
              : { level: "terminal", projectId, terminalId },
          );
        });
      return;
    }
    void startSession({
      cwd,
      permissionMode: mode,
      // The engine starts Claude Code when no provider is named, as it always did.
      ...(provider !== DEFAULT_PROVIDER ? { provider } : {}),
      ...(model ? { model } : {}),
    }).then((r) => {
      setBusy(false);
      if (r.ok) {
        navigate({ level: "session", projectId: r.value.projectId, sessionId: r.value.sessionId });
      } else {
        setError(describeError(r.error));
      }
    });
  };

  return {
    folder,
    provider,
    model,
    mode,
    runIn,
    setRunIn,
    setFolder: (v) => {
      setFolder(v);
      if (missing === "folder") setMissing(undefined);
    },
    setProvider: (v) => {
      if (v === provider) return;
      setProvider(v);
      setModel("");
      setMode(DEFAULT_MODE[v]);
    },
    setModel,
    setMode,
    busy,
    missing,
    error,
    submit,
  };
}
