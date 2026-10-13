const KEY = "gravita.theme";
type Theme = "light" | "dark";

export interface ThemeController {
  /** Flips light ↔ dark and remembers the choice. */
  toggle(): void;
  /** Stops following the OS setting. */
  dispose(): void;
}

function readStored(): Theme | undefined {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : undefined;
  } catch {
    // No storage: follow the OS.
    return undefined;
  }
}

/**
 * The theme is always explicit on <html>: the user's choice, else the OS, kept in sync.
 * The only module that touches `data-theme`, localStorage for it, and the media query.
 */
export function startTheme(root: HTMLElement = document.documentElement): ThemeController {
  const os = matchMedia("(prefers-color-scheme: dark)");
  const stored = readStored();
  const sync = () => {
    root.dataset.theme = stored ?? (os.matches ? "dark" : "light");
  };
  sync();
  os.addEventListener("change", sync);

  return {
    toggle() {
      const dark =
        root.dataset.theme === "dark" ||
        (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      root.dataset.theme = dark ? "light" : "dark";
      try {
        localStorage.setItem(KEY, root.dataset.theme);
      } catch {
        // Theme then lasts for this window only.
      }
    },
    dispose() {
      os.removeEventListener("change", sync);
    },
  };
}
