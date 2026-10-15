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

/**
 * The Cursor API key's storage in the desktop shell (the macOS Keychain, ADR 008). The key
 * goes one way: the webview can store, replace or remove it and ask whether there is one,
 * never read it back. The shell hands it to the engine itself.
 */
export interface CursorKeyBridge {
  present(): Promise<boolean>;
  set(key: string): Promise<void>;
  remove(): Promise<void>;
}

/** The shell's key commands; absent in a plain browser, where no key can be set. */
export function createCursorKeyBridge(): CursorKeyBridge | undefined {
  if (!isTauri()) return undefined;
  const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    const core = await import("@tauri-apps/api/core");
    return core.invoke<T>(cmd, args);
  };
  return {
    present: () => invoke<boolean>("cursor_key_present"),
    set: (value) => invoke<void>("cursor_key_set", { value }),
    remove: () => invoke<void>("cursor_key_remove"),
  };
}

/** Opens Codex's sign-in page (Gravita's Codex profile for squads) in the user's browser. */
export type OpenSignIn = (url: string) => Promise<void>;

/** Only OpenAI's own https pages are opened: the link comes from Codex, through the engine. */
export function isSignInUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (
      u.protocol === "https:" &&
      [".openai.com", ".chatgpt.com"].some((d) => host.endsWith(d) || host === d.slice(1))
    );
  } catch {
    return false;
  }
}

/**
 * The browser for a sign-in link. Inside Tauri the shell's own `open_sign_in_url` command
 * opens it (it checks the link again: https, OpenAI's hosts only; the webview gets no
 * general opener); in a plain browser, a new tab without a way back to Gravita's page.
 */
export function createSignInOpener(): OpenSignIn {
  return async (url) => {
    if (!isSignInUrl(url)) throw new Error("Not a Codex sign-in link");
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_sign_in_url", { url });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };
}

/**
 * Installs the newest release in place: downloads its package, checks it against the public
 * key built into the app, swaps the app and opens it again. `onProgress` gets the share
 * downloaded (0 to 1) while it runs, or undefined when the size isn't known.
 */
export interface AppUpdater {
  install(onProgress?: (share: number | undefined) => void): Promise<void>;
}

/**
 * The shell's own updater, only inside Tauri (capability `updater:default`; the restart is
 * the shell's `restart_app` command, which stops the engine first). The plugin loads on
 * first use. It rejects when the release publishes no package for this build, and the
 * caller then falls back to the installer download.
 */
export function createAppUpdater(): AppUpdater | undefined {
  if (!isTauri()) return undefined;
  return {
    async install(onProgress) {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) throw new Error("No update package for this build");
      let total: number | undefined;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength;
        else if (event.event === "Progress") {
          done += event.data.chunkLength;
          onProgress?.(total ? Math.min(1, done / total) : undefined);
        }
      });
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("restart_app");
    },
  };
}

/** Opens a release page of Gravita's repository in the user's browser. */
export type OpenRelease = (url: string) => Promise<void>;

const RELEASES = "https://github.com/WillDant/gravita/releases";

/** Only the repository's own release pages are opened (the link comes through the engine). */
export function isReleaseUrl(url: string): boolean {
  // No whitespace or control characters, whatever the link starts with.
  if ([...url].some((c) => c <= " " || c === "\u007f") || !url.startsWith(RELEASES)) return false;
  const rest = url.slice(RELEASES.length);
  return rest === "" || "/?#".includes(rest[0] as string);
}

/**
 * The browser for a release link. Inside Tauri the shell's own `open_release_url` command
 * opens it (it checks the link again; the webview gets no general opener); in a plain
 * browser, a new tab without a way back to Gravita's page.
 */
export function createReleaseOpener(): OpenRelease {
  return async (url) => {
    if (!isReleaseUrl(url)) throw new Error("Not a Gravita release link");
    if (isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_release_url", { url });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };
}
