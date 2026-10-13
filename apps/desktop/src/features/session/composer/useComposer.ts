import type { SessionState } from "@gravita/core";
import type { PermissionMode } from "@gravita/protocol";
import { useEffect, useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { describeError } from "@/shared/presenters/errors";
import { type CommandResult, useControl } from "@/state/hooks";

export interface ComposerModel {
  text: string;
  setText: (text: string) => void;
  sending: boolean;
  interrupting: boolean;
  /** The last failure, in the user's words (send, interrupt or a setting change). */
  error?: string;
  send: () => void;
  interrupt: () => void;
  model: string;
  mode: PermissionMode;
  changeModel: (model: string) => void;
  changeMode: (mode: PermissionMode) => void;
}

/** Messages, interrupt and settings for a session Gravita runs. */
export function useComposer(session: SessionState): ComposerModel {
  const control = useControl();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [error, setError] = useState<string>();
  // A setting shows its new value until the session reports it (or the change fails).
  const [pendingModel, setPendingModel] = useState<string>();
  const [pendingMode, setPendingMode] = useState<PermissionMode>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the session caught up.
  useEffect(() => setPendingModel(undefined), [session.model]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the session caught up.
  useEffect(() => setPendingMode(undefined), [session.permissionMode]);

  const report = (r: CommandResult, kind?: "setting") => {
    if (r.ok) return;
    const reason = describeError(r.error).text;
    setError(kind === "setting" ? t("composer.settingFailed", { reason }) : reason);
  };

  const send = () => {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(undefined);
    void control.sendMessage(session.id, message).then((r) => {
      setSending(false);
      if (r.ok) setText("");
      else report(r);
    });
  };

  const interrupt = () => {
    if (interrupting) return;
    setInterrupting(true);
    setError(undefined);
    void control.interrupt(session.id).then((r) => {
      setInterrupting(false);
      report(r);
    });
  };

  const changeModel = (model: string) => {
    setPendingModel(model);
    setError(undefined);
    void control.setModel(session.id, model).then((r) => {
      if (!r.ok) setPendingModel(undefined);
      report(r, "setting");
    });
  };

  const changeMode = (mode: PermissionMode) => {
    setPendingMode(mode);
    setError(undefined);
    void control.setPermissionMode(session.id, mode).then((r) => {
      if (!r.ok) setPendingMode(undefined);
      report(r, "setting");
    });
  };

  return {
    text,
    setText: (next) => {
      setText(next);
      if (error) setError(undefined);
    },
    sending,
    interrupting,
    error,
    send,
    interrupt,
    model: pendingModel ?? session.model ?? "",
    mode: pendingMode ?? session.permissionMode ?? "default",
    changeModel,
    changeMode,
  };
}
