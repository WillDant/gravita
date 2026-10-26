import { isTauri } from "./tauri";

/**
 * True when the window draws macOS's frosted material behind the webview
 * (tauri.macos.conf.json): only there can the menu show it through.
 */
export function hasWindowVibrancy(): boolean {
  return isTauri() && /Mac/.test(navigator.userAgent);
}

/**
 * Marks <html data-vibrancy> and keeps the native material on the app's theme: macOS paints
 * it from the window's appearance, which follows the OS unless told otherwise. A no-op
 * without vibrancy. Returns the teardown.
 */
export function startWindowAppearance(root: HTMLElement = document.documentElement): () => void {
  if (!hasWindowVibrancy()) return () => {};
  root.dataset.vibrancy = "";
  const sync = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(root.dataset.theme === "dark" ? "dark" : "light");
  };
  const run = () => {
    sync().catch(() => {
      // The material then follows the OS appearance; the menu's tint still reads.
    });
  };
  run();
  const observer = new MutationObserver(run);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
