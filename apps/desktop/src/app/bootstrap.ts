import { startNotifications } from "@/application/notifications/notificationService";
import { startTraySync, stoppedAllNotice } from "@/application/tray/traySync";
import { resolveEndpoint } from "@/infrastructure/engine/resolveEndpoint";
import { WsEngineGateway } from "@/infrastructure/engine/WsEngineGateway";
import { domAttention } from "@/infrastructure/platform/attention";
import { createNotifier } from "@/infrastructure/platform/notifier";
import { createFolderPicker, createSignInOpener } from "@/infrastructure/platform/tauri";
import { createTray } from "@/infrastructure/platform/tray";
import { createNotificationPrefs } from "@/infrastructure/preferences/notificationPrefs";
import { startTheme } from "@/infrastructure/theme/themeStorage";
import { getLocale, subscribeLocale } from "@/shared/i18n/i18n";
import { syncWithEngine } from "@/state/engineSync";
import { createAppStore } from "@/state/store";
import type { AppServices } from "./providers";
import { createHashRouter } from "./router";

export interface App {
  services: AppServices;
  /** Tears down every side effect bootstrap started. */
  dispose: () => void;
}

/** Composition root: the only place that knows the concrete classes. */
export function bootstrap(): App {
  const theme = startTheme();
  const router = createHashRouter();
  const gateway = new WsEngineGateway(resolveEndpoint);
  const store = createAppStore(gateway, { route: router.current(), now: Date.now() });
  const notificationPrefs = createNotificationPrefs();

  const unsync = syncWithEngine(store, gateway);
  const unroute = router.subscribe((route) => store.getState().setRoute(route));
  const clock = setInterval(() => store.getState().tick(Date.now()), 1000);
  const unnotify = startNotifications({
    store,
    gateway,
    notifier: createNotifier(),
    attention: domAttention(),
    prefs: notificationPrefs,
    navigate: router.navigate,
  });

  // The menu-bar tray exists only inside the Tauri shell.
  const tray = createTray();
  const untray = tray
    ? startTraySync({ store, tray, locale: { get: getLocale, subscribe: subscribeLocale } })
    : () => {};
  const unstopped =
    tray?.onStoppedAll((result) => {
      const { key, params } = stoppedAllNotice(result);
      store.getState().showNotice(key, params);
    }) ?? (() => {});

  gateway.connect();
  const route = store.getState().route;
  if (route.level === "session") store.getState().loadSession(route.sessionId);

  return {
    services: {
      store,
      gateway,
      navigate: router.navigate,
      toggleTheme: theme.toggle,
      pickFolder: createFolderPicker(),
      openSignIn: createSignInOpener(),
      notificationPrefs,
    },
    dispose: () => {
      clearInterval(clock);
      unstopped();
      untray();
      unnotify();
      unroute();
      unsync();
      router.dispose();
      gateway.close();
      theme.dispose();
    },
  };
}
