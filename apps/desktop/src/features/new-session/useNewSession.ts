import { DEFAULT_MODE } from "@gravita/core";
import type { SessionMode } from "@gravita/protocol";
import { type AgentProvider, DEFAULT_PROVIDER } from "@gravita/protocol/constants";
import { useState } from "react";
import { useNavigate } from "@/app/providers";
import { describeError, type ErrorView } from "@/shared/presenters/errors";
import { useControl } from "@/state/hooks";

export type MissingField = "folder" | "message";

export interface NewSessionForm {
  folder: string;
  message: string;
  /** The agent the session runs: Claude Code unless Codex is chosen. */
  provider: AgentProvider;
  /** "" means the provider's own default. */
  model: string;
  /** In the provider's own terms. */
  mode: SessionMode;
  setFolder: (v: string) => void;
  setMessage: (v: string) => void;
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
  const navigate = useNavigate();
  const [folder, setFolder] = useState(defaultFolder);
  const [message, setMessage] = useState("");
  const [provider, setProvider] = useState<AgentProvider>(DEFAULT_PROVIDER);
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<SessionMode>(DEFAULT_MODE[DEFAULT_PROVIDER]);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<MissingField>();
  const [error, setError] = useState<ErrorView>();

  const submit = () => {
    if (busy) return;
    const cwd = folder.trim();
    const prompt = message.trim();
    const empty: MissingField | undefined = !cwd ? "folder" : !prompt ? "message" : undefined;
    setMissing(empty);
    setError(undefined);
    if (empty) return;
    setBusy(true);
    void startSession({
      cwd,
      prompt,
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
    message,
    provider,
    model,
    mode,
    setFolder: (v) => {
      setFolder(v);
      if (missing === "folder") setMissing(undefined);
    },
    setMessage: (v) => {
      setMessage(v);
      if (missing === "message") setMissing(undefined);
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
