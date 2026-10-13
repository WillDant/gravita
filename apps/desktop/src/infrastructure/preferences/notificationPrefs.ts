const KEY = "gravita.notifications";

/** Which OS notifications the user wants while Gravita is in the background. */
export interface NotificationPrefs {
  /** An agent starts waiting on the user (permission or question). */
  waiting: boolean;
  /** A chat Gravita runs finishes its turn. */
  finished: boolean;
  /** An agent stops with an error. */
  failures: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  waiting: true,
  finished: true,
  failures: true,
};

/** The preferences, remembered in localStorage when it's there (memory only otherwise). */
export interface NotificationPrefsStore {
  get(): NotificationPrefs;
  set(patch: Partial<NotificationPrefs>): void;
  subscribe(listener: () => void): () => void;
}

function read(storage: () => Storage): NotificationPrefs {
  try {
    const raw = storage().getItem(KEY);
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw) as Partial<Record<keyof NotificationPrefs, unknown>>;
    const pick = (k: keyof NotificationPrefs) =>
      typeof parsed[k] === "boolean" ? (parsed[k] as boolean) : DEFAULT_NOTIFICATION_PREFS[k];
    return { waiting: pick("waiting"), finished: pick("finished"), failures: pick("failures") };
  } catch {
    // No storage, or something unreadable in it: the defaults.
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function createNotificationPrefs(
  storage: () => Storage = () => localStorage,
): NotificationPrefsStore {
  let prefs = read(storage);
  const listeners = new Set<() => void>();
  return {
    get: () => prefs,
    set(patch) {
      prefs = { ...prefs, ...patch };
      try {
        storage().setItem(KEY, JSON.stringify(prefs));
      } catch {
        // The choice then lasts for this window only.
      }
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
