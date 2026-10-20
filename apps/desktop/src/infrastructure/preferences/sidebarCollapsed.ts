const KEY = "gravita.sidebar.collapsed";

/** Whether the user collapsed the menu (`undefined`: they never chose, so the window decides). */
export function readSidebarCollapsed(
  storage: () => Storage = () => localStorage,
): boolean | undefined {
  try {
    const raw = storage().getItem(KEY);
    return raw === "true" ? true : raw === "false" ? false : undefined;
  } catch {
    // No storage: the window decides.
    return undefined;
  }
}

export function writeSidebarCollapsed(
  collapsed: boolean,
  storage: () => Storage = () => localStorage,
): void {
  try {
    storage().setItem(KEY, String(collapsed));
  } catch {
    // The choice then lasts for this window only.
  }
}
