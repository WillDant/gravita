import type { GravitaState } from "@gravita/core";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Mock } from "vitest";
import { vi } from "vitest";
import { AppProviders } from "@/app/providers";
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
  { state, gateway = new FakeGateway() }: { state?: GravitaState; gateway?: FakeGateway } = {},
): AppRender {
  const store = createAppStore(gateway, { now: NOW });
  if (state) store.getState().loadSnapshot({ seq: state.seq, state });
  const navigate = vi.fn<(route: Route) => void>();
  const view = render(
    <AppProviders services={{ store, gateway, navigate, toggleTheme: () => {} }}>
      {ui}
    </AppProviders>,
  );
  return { ...view, gateway, store, navigate };
}
