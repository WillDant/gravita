import { isTauri } from "./tauri";

/** What the menu-bar tray shows (the shell renders it; see src-tauri/src/tray.rs). */
export interface TrayStatus {
  running: number;
  waiting: number;
  /** Running sessions Gravita runs: enables the tray's "Stop all Gravita agents". */
  controllable: number;
  locale: string;
}

/** The tray's kill switch ran: how many sessions the engine stopped, or why it couldn't. */
export type StoppedAll = { stopped: number } | { error: string };

/** The port to the shell's tray. Only exists inside Tauri. */
export interface Tray {
  update(status: TrayStatus): Promise<void>;
  /** Called after the tray's kill switch ran. */
  onStoppedAll(listener: (result: StoppedAll) => void): () => void;
}

/** Must match `STOPPED_ALL_EVENT` in src-tauri/src/tray.rs. */
export const STOPPED_ALL_EVENT = "gravita://stopped-all";

/** Tauri's IPC, loaded on first use like the rest of the shell bindings. */
export function tauriTray(): Tray {
  return {
    async update(status) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("tray_update", { ...status });
    },
    onStoppedAll(listener) {
      let disposed = false;
      let unlisten: (() => void) | undefined;
      void import("@tauri-apps/api/event").then(({ listen }) =>
        listen<StoppedAll>(STOPPED_ALL_EVENT, (e) => listener(e.payload)).then((off) => {
          if (disposed) off();
          else unlisten = off;
        }),
      );
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
  };
}

export function createTray(): Tray | undefined {
  return isTauri() ? tauriTray() : undefined;
}
