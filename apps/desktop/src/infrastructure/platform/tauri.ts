/** True inside the Tauri shell; false in a plain browser (dev mode, tests). */
export function isTauri(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

/** Asks the user for a folder; resolves to its path, or null when they cancel. */
export type PickFolder = () => Promise<string | null>;

/**
 * The native folder picker, only inside Tauri (the shell grants `dialog:allow-open` and
 * nothing else). The plugin loads on first use, so the browser bundle never carries it.
 */
export function createFolderPicker(): PickFolder | undefined {
  if (!isTauri()) return undefined;
  return async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  };
}
