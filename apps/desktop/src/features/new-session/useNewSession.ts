import type { PermissionMode } from "@gravita/protocol";
import { useState } from "react";
import { useNavigate } from "@/app/providers";
import { describeError, type ErrorView } from "@/shared/presenters/errors";
import { useControl } from "@/state/hooks";

export type MissingField = "folder" | "message";

export interface NewSessionForm {
  folder: string;
  message: string;
  /** "" means Claude Code's own default. */
  model: string;
  mode: PermissionMode;
  setFolder: (v: string) => void;
  setMessage: (v: string) => void;
  setModel: (v: string) => void;
  setMode: (v: PermissionMode) => void;
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
  const [model, setModel] = useState("");
  const [mode, setMode] = useState<PermissionMode>("default");
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
    setModel,
    setMode,
    busy,
    missing,
    error,
    submit,
  };
}
