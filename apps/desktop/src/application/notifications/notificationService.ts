import type { EngineGateway } from "@/infrastructure/engine/EngineGateway";
import type { WindowAttention } from "@/infrastructure/platform/attention";
import type { Notifier } from "@/infrastructure/platform/notifier";
import type { NotificationPrefsStore } from "@/infrastructure/preferences/notificationPrefs";
import { t } from "@/shared/i18n/i18n";
import type { Route } from "@/state/slices/route";
import type { AppStore } from "@/state/store";
import { createPendingLink } from "./deepLink";
import { type NotificationIntent, notificationsFor, PRIORITY, stillRelevant } from "./rules";

/** At most one notification per session in this window; the rest fold into "+N more". */
export const COALESCE_MS = 5_000;

export interface NotificationDeps {
  store: AppStore;
  gateway: Pick<EngineGateway, "onEvents">;
  notifier: Notifier;
  attention: WindowAttention;
  prefs: Pick<NotificationPrefsStore, "get">;
  navigate: (route: Route) => void;
  clock?: () => number;
}

/**
 * OS notifications for live engine events while the window is in the background, and the
 * deep link back when it returns. Only `gateway.onEvents` feeds it: snapshots (first load,
 * every reconnect) never notify. Returns the stop function.
 */
export function startNotifications(deps: NotificationDeps): () => void {
  const clock = deps.clock ?? Date.now;
  const link = createPendingLink();
  const lastShown = new Map<string, number>();
  const queued = new Map<
    string,
    { items: NotificationIntent[]; timer: ReturnType<typeof setTimeout> }
  >();
  let asked = false;
  let disposed = false;

  // Asks the OS once, on the first notification we'd send; a "no" keeps us quiet.
  const allowed = async () => {
    let permission = await deps.notifier.permission();
    if (permission === "default" && !asked) {
      asked = true;
      permission = await deps.notifier.requestPermission();
    }
    return permission === "granted";
  };

  const show = (n: NotificationIntent, more: number) => {
    lastShown.set(n.sessionId, clock());
    void (async () => {
      try {
        if (!(await allowed()) || disposed) return;
        const body = more > 0 ? `${n.body} · ${t("notify.more", { count: more })}` : n.body;
        await deps.notifier.notify({ title: n.title, body });
        link.remember(n, clock());
      } catch {
        // The OS refused or the plugin is missing: stay quiet.
      }
    })();
  };

  const flush = (sessionId: string) => {
    const q = queued.get(sessionId);
    queued.delete(sessionId);
    if (!q || disposed || deps.attention.attended()) return;
    const state = deps.store.getState().projection;
    const now = clock();
    const items = q.items.filter((n) => stillRelevant(n, state, now));
    if (items.length === 0) return;
    // The most pressing kind wins; among equals, the latest.
    const best = items.reduce((a, b) => (PRIORITY[b.kind] <= PRIORITY[a.kind] ? b : a));
    show(best, items.length - 1);
  };

  const offer = (n: NotificationIntent) => {
    if (deps.attention.attended()) return;
    const pending = queued.get(n.sessionId);
    if (pending) {
      pending.items.push(n);
      return;
    }
    const now = clock();
    const last = lastShown.get(n.sessionId);
    if (last !== undefined && now - last < COALESCE_MS) {
      const timer = setTimeout(() => flush(n.sessionId), last + COALESCE_MS - now);
      queued.set(n.sessionId, { items: [n], timer });
      return;
    }
    show(n, 0);
  };

  const offEvents = deps.gateway.onEvents((batch) => {
    // Read the projection after the store applied this batch, whatever the listener order.
    queueMicrotask(() => {
      if (disposed) return;
      const state = deps.store.getState().projection;
      for (const n of notificationsFor(batch.events, state, clock(), deps.prefs.get())) offer(n);
    });
  });

  const offAttend = deps.attention.onAttend(() => {
    // The user is back: whatever was still folding is moot.
    for (const q of queued.values()) clearTimeout(q.timer);
    queued.clear();
    const route = link.take(deps.store.getState().projection, clock());
    if (route) deps.navigate(route);
  });

  return () => {
    disposed = true;
    offEvents();
    offAttend();
    for (const q of queued.values()) clearTimeout(q.timer);
    queued.clear();
  };
}
