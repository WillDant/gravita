import type { GravitaState } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import { createContext, useContext, useEffect } from "react";
import { useStore } from "zustand";
import type { ClaudeProblem } from "@/shared/presenters/errors";
import type { ModelOption } from "./slices/control";

export type { CommandResult, ModelOption } from "./slices/control";

import type { ConversationView } from "./slices/conversation";
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

/** Why Claude Code can't run sessions right now, if it can't (never in demo mode). */
export function useClaudeProblem(): ClaudeProblem | undefined {
  return useAppStore((s) => {
    const status = s.engineStatus;
    if (!status || status.demo) return undefined;
    if (!status.claude.found) return "missing";
    if (status.claude.outdated) return "outdated";
    if (status.claude.loggedIn === false) return "loggedOut";
    return undefined;
  });
}

/** Claude Code's models, loaded once on first use. */
export function useModels(): ModelOption[] {
  const load = useAppStore((s) => s.loadModels);
  const connection = useConnection();
  useEffect(() => {
    if (connection === "online") load();
  }, [load, connection]);
  return useAppStore((s) => s.models);
}

/** The full conversation of a session, loaded while the caller is mounted. */
export function useConversation(sessionId: string): ConversationView | undefined {
  const open = useAppStore((s) => s.openConversation);
  const close = useAppStore((s) => s.closeConversation);
  useEffect(() => {
    open(sessionId);
    return () => close(sessionId);
  }, [open, close, sessionId]);
  return useAppStore((s) => (s.conversation?.sessionId === sessionId ? s.conversation : undefined));
}

/** Store actions for driving sessions (start, send, interrupt, answer…). */
export function useControl() {
  return {
    startSession: useAppStore((s) => s.startSession),
    sendMessage: useAppStore((s) => s.sendMessage),
    interrupt: useAppStore((s) => s.interrupt),
    stopAgent: useAppStore((s) => s.stopAgent),
    setModel: useAppStore((s) => s.setModel),
    setPermissionMode: useAppStore((s) => s.setPermissionMode),
    answerQuestion: useAppStore((s) => s.answerQuestion),
  };
}

export const useStartingSessionId = (): string | undefined =>
  useAppStore((s) => s.startingSessionId);
