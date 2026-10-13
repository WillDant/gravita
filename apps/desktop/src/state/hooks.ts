import type { GravitaState } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { Route } from "./slices/route";
import type { AppState, AppStore } from "./store";

export const StoreContext = createContext<AppStore | null>(null);

function useStoreApi(): AppStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("StoreContext is missing: wrap the app in <AppProviders>");
  return store;
}

/** Selects from the app store. Selectors must return stable references (no new arrays). */
export function useAppStore<T>(selector: (s: AppState) => T): T {
  return useStore(useStoreApi(), selector);
}

/** Selects from the engine projection; untouched sessions/projects keep their reference. */
export function useProjection<T>(selector: (p: GravitaState) => T): T {
  return useAppStore((s) => selector(s.projection));
}

export const useRoute = (): Route => useAppStore((s) => s.route);
export const useNow = (): number => useAppStore((s) => s.now);
export const useConnection = () => useAppStore((s) => s.connection);
export const useIsDemo = (): boolean => useAppStore((s) => Boolean(s.engineStatus?.demo));

const NO_EVENTS: GravitaEvent[] = [];

/** Live events of `sessionId` when it's the open session, else an empty list. */
export function useSessionEvents(sessionId: string): GravitaEvent[] {
  return useAppStore((s) => (s.openSession?.id === sessionId ? s.openSession.events : NO_EVENTS));
}
