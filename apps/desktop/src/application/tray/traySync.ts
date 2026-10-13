import type { StoppedAll, Tray, TrayStatus } from "@/infrastructure/platform/tray";
import { trayCounts } from "@/shared/presenters/selectors";
import type { AppStore } from "@/state/store";

export const TRAY_DEBOUNCE_MS = 300;

export interface TraySyncDeps {
  store: AppStore;
  tray: Pick<Tray, "update">;
  locale: { get(): string; subscribe(listener: () => void): () => void };
  debounceMs?: number;
}

const same = (a: TrayStatus | undefined, b: TrayStatus) =>
  a !== undefined &&
  a.running === b.running &&
  a.waiting === b.waiting &&
  a.controllable === b.controllable &&
  a.locale === b.locale;

/**
 * Keeps the menu-bar tray in step with the projection: the same counts as Home and the
 * sidebar, sent debounced and only when they change (the clock ticks every second, the
 * numbers rarely do). Returns the stop function.
 */
export function startTraySync({
  store,
  tray,
  locale,
  debounceMs = TRAY_DEBOUNCE_MS,
}: TraySyncDeps): () => void {
  let sent: TrayStatus | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seen: { projection: unknown; now: number; locale: string } | undefined;

  const current = (): TrayStatus => {
    const { projection, now } = store.getState();
    return { ...trayCounts(projection, now), locale: locale.get() };
  };

  const send = () => {
    timer = undefined;
    const status = current();
    if (same(sent, status)) return;
    sent = status;
    tray.update(status).catch(() => {
      // Try again on the next change.
      sent = undefined;
    });
  };

  const schedule = () => {
    const { projection, now } = store.getState();
    const lang = locale.get();
    // Cheap early-out: nothing the counts depend on moved.
    if (seen && seen.projection === projection && seen.now === now && seen.locale === lang) return;
    seen = { projection, now, locale: lang };
    // One send per window: a burst of batches can't starve the tray, and the send reads
    // the state as it is when the window closes.
    if (timer !== undefined || same(sent, current())) return;
    timer = setTimeout(send, debounceMs);
  };

  const offStore = store.subscribe(schedule);
  const offLocale = locale.subscribe(schedule);
  schedule();

  return () => {
    clearTimeout(timer);
    offStore();
    offLocale();
  };
}

/** The calm line shown after the tray's kill switch ran. */
export function stoppedAllNotice(result: StoppedAll): {
  key: string;
  params?: Record<string, number>;
} {
  if ("error" in result) return { key: "notice.stopFailed" };
  if (result.stopped === 0) return { key: "notice.stoppedNone" };
  return { key: "notice.stopped", params: { count: result.stopped } };
}
