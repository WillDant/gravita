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
