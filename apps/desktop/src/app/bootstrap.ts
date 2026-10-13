import { resolveEndpoint } from "@/infrastructure/engine/resolveEndpoint";
import { WsEngineGateway } from "@/infrastructure/engine/WsEngineGateway";
import { startTheme } from "@/infrastructure/theme/themeStorage";
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

  const unsync = syncWithEngine(store, gateway);
  const unroute = router.subscribe((route) => store.getState().setRoute(route));
  const clock = setInterval(() => store.getState().tick(Date.now()), 1000);

  gateway.connect();
  const route = store.getState().route;
  if (route.level === "session") store.getState().loadSession(route.sessionId);

  return {
    services: { store, gateway, navigate: router.navigate, toggleTheme: theme.toggle },
    dispose: () => {
      clearInterval(clock);
      unroute();
      unsync();
      router.dispose();
      gateway.close();
      theme.dispose();
    },
  };
}
