import type { CredentialState } from "@gravita/protocol/constants";
import { useEffect, useState } from "react";
import { useCursorKeyBridge, useGateway } from "@/app/providers";
import { useCursorCredential } from "@/state/hooks";

export type CursorKeyAction = "save" | "validate" | "remove";

/** Whether `value` can be a Cursor API key: one token, nothing to trim away. */
export function looksLikeKey(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !/\s/.test(value);
}

/**
 * The Cursor key as the UI may know it: whether one is stored and how Cursor took it,
 * never the key. Saving hands the typed key straight to the shell (Keychain), which
 * passes it to the engine; the engine checks it and reports the state in its status.
 * Without the shell (a plain browser) no key can be set.
 */
export function useCursorKey() {
  const bridge = useCursorKeyBridge();
  const gateway = useGateway();
  const credential = useCursorCredential();
  const [present, setPresent] = useState<boolean>();
  const [busy, setBusy] = useState<CursorKeyAction>();
  const [failed, setFailed] = useState<CursorKeyAction>();

  useEffect(() => {
    let live = true;
    bridge?.present().then(
      (p) => live && setPresent(p),
      () => live && setPresent(false),
    );
    return () => {
      live = false;
    };
  }, [bridge]);

  // The shell knows first that a key was saved or removed; the engine's word follows.
  const engine = credential?.source === "app" ? credential.state : undefined;
  const state: CredentialState =
    present === false || (present === undefined && !engine) ? "missing" : (engine ?? "unchecked");

  const run = async (action: CursorKeyAction, work: () => Promise<void>): Promise<boolean> => {
    setBusy(action);
    setFailed(undefined);
    try {
      await work();
      return true;
    } catch {
      setFailed(action);
      return false;
    } finally {
      setBusy(undefined);
    }
  };

  return {
    /** False in a plain browser: the key is set only in the desktop app. */
    available: Boolean(bridge),
    state,
    busy,
    failed,
    save: (key: string) =>
      run("save", async () => {
        if (!bridge) throw new Error("unavailable");
        await bridge.set(key);
        setPresent(true);
      }),
    validate: () =>
      run("validate", async () => {
        await gateway.validateCursorKey();
      }),
    remove: () =>
      run("remove", async () => {
        if (!bridge) throw new Error("unavailable");
        await bridge.remove();
        setPresent(false);
      }),
  };
}
