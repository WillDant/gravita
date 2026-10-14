import type { GravitaState, UsageLimitState } from "@gravita/core";
import type { AccountPlan, EngineStatus, GravitaEvent, ProviderStatus } from "@gravita/protocol";
import type { AgentProvider } from "@gravita/protocol/constants";
import { createContext, useContext, useEffect } from "react";
import { useStore } from "zustand";
import type { ProviderProblem } from "@/shared/presenters/errors";
import { accountPlan } from "@/shared/presenters/planUsage";
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

/**
 * One provider's status. An engine from before providers sends only `claude`, so Claude
 * Code's status falls back to it.
 */
export function providerStatus(
  status: EngineStatus,
  provider: AgentProvider,
): ProviderStatus | undefined {
  return status.providers?.[provider] ?? (provider === "claude" ? status.claude : undefined);
}

/** Why a provider can't run sessions right now, if it can't (never in demo mode). */
export function problemOf(
  status: EngineStatus | undefined,
  provider: AgentProvider,
): ProviderProblem | undefined {
  if (!status || status.demo) return undefined;
  const p = providerStatus(status, provider);
  if (!p?.found) return "missing";
  if (p.outdated) return "outdated";
  if (p.loggedIn === false) return "loggedOut";
  return undefined;
}

/** Why `provider` (Claude Code by default) can't run sessions right now, if it can't. */
export function useProviderProblem(
  provider: AgentProvider = "claude",
): ProviderProblem | undefined {
  return useAppStore((s) => problemOf(s.engineStatus, provider));
}

const NO_MODELS: ModelOption[] = [];

/** A provider's models (Claude Code's by default), loaded once on first use. */
export function useModels(provider: AgentProvider = "claude"): ModelOption[] {
  const load = useAppStore((s) => s.loadModels);
  const connection = useConnection();
  useEffect(() => {
    if (connection === "online") load(provider);
  }, [load, connection, provider]);
  return useAppStore((s) => s.models[provider] ?? NO_MODELS);
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

export const useNotice = () => useAppStore((s) => s.notice);

export const useStartingSessionId = (): string | undefined =>
  useAppStore((s) => s.startingSessionId);

const NO_USAGE: Record<string, UsageLimitState> = {};

/** The latest plan usage readings, by provider and window (account-wide). */
export const useUsage = (): Record<string, UsageLimitState> =>
  useAppStore((s) => s.projection.usage ?? NO_USAGE);

/** Whether plan limits apply to `provider`'s account (`limited`) or it pays per token (`api`). */
export function useAccountPlan(provider: AgentProvider = "claude"): AccountPlan | undefined {
  return useAppStore((s) => accountPlan(s.engineStatus, provider));
}

/**
 * Asks the engine for fresh plan usage while the caller is mounted (a chat or squad screen,
 * the new-squad panel): once on mount and on each reconnect. Cheap by design: the engine
 * reads through a running session at most once a minute and never starts one.
 */
export function useUsageRefresh(provider: AgentProvider = "claude") {
  const refresh = useAppStore((s) => s.refreshUsage);
  const connection = useConnection();
  useEffect(() => {
    if (connection === "online") void refresh(provider);
  }, [refresh, connection, provider]);
}
