const KEY = "gravita.update.dismissed";

/** The release version whose notice the user sent away (none: no notice was dismissed). */
export function readDismissedUpdate(
  storage: () => Storage = () => localStorage,
): string | undefined {
  try {
    return storage().getItem(KEY) ?? undefined;
  } catch {
    // No storage: the notice shows again next time.
    return undefined;
  }
}

export function writeDismissedUpdate(
  version: string,
  storage: () => Storage = () => localStorage,
): void {
  try {
    storage().setItem(KEY, version);
  } catch {
    // The notice then stays away for this window only.
  }
}
