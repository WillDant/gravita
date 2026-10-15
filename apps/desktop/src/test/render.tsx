import type { GravitaState } from "@gravita/core";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Mock } from "vitest";
import { vi } from "vitest";
import { AppProviders } from "@/app/providers";
import type { CursorKeyBridge, PickFolder } from "@/infrastructure/platform/tauri";
import { createNotificationPrefs } from "@/infrastructure/preferences/notificationPrefs";
import { createProjectAppearance } from "@/infrastructure/preferences/projectAppearance";
import type { Route } from "@/state/slices/route";
import { type AppStore, createAppStore } from "@/state/store";
import { NOW } from "./events";
import { FakeGateway } from "./FakeGateway";

/** Renders `ui` inside the app's providers, with a fake engine holding `state`. */
export interface AppRender extends RenderResult {
  gateway: FakeGateway;
  store: AppStore;
  navigate: Mock<(route: Route) => void>;
}

export function renderWithApp(
  ui: ReactNode,
  {
    state,
    gateway = new FakeGateway(),
    cursorKey,
    pickFolder,
    toggleTheme = () => {},
  }: {
    state?: GravitaState;
    gateway?: FakeGateway;
    cursorKey?: CursorKeyBridge;
    pickFolder?: PickFolder;
    toggleTheme?: () => void;
  } = {},
): AppRender {
  const storage = memoryStorage();
  const store = createAppStore(gateway, { now: NOW, layoutStorage: () => storage });
  if (state) store.getState().loadSnapshot({ seq: state.seq, state });
  const navigate = vi.fn<(route: Route) => void>();
  const view = render(
    <AppProviders
      services={{
        store,
        gateway,
        navigate,
        toggleTheme,
        ...(cursorKey ? { cursorKey } : {}),
        ...(pickFolder ? { pickFolder } : {}),
        notificationPrefs: createNotificationPrefs(() => storage),
        projectAppearance: createProjectAppearance(() => storage),
      }}
    >
      {ui}
    </AppProviders>,
  );
  return { ...view, gateway, store, navigate };
}

/** An empty in-memory Storage: tests never share preferences through localStorage. */
export function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => {
      data.delete(k);
    },
    setItem: (k, v) => {
      data.set(k, String(v));
    },
  };
}
