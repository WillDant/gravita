import type { GravitaState, UsageLimitState } from "@gravita/core";
import type {
  AccountPlan,
  CodexProfileStatus,
  EngineStatus,
  GravitaEvent,
  ProviderStatus,
  TerminalInfo,
} from "@gravita/protocol";
import { AGENT_PROVIDERS, type AgentProvider } from "@gravita/protocol/constants";
import { createContext, useContext, useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { ProviderProblem } from "@/shared/presenters/errors";
import { accountPlan } from "@/shared/presenters/planUsage";
import { terminalProvider } from "@/shared/presenters/terminal";
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
  if (provider === "cursor") return keyProblemOf(p);
  if (p.loggedIn === false) return "loggedOut";
  return undefined;
}

/** Cursor runs only with the key set in Gravita: none yet, or one Cursor turned down. */
function keyProblemOf(p: ProviderStatus): ProviderProblem | undefined {
  const credential = p.credential;
  if (!credential || credential.source === "none") return "keyMissing";
  return credential.state === "invalid" ? "keyInvalid" : undefined;
}

/** Why `provider` (Claude Code by default) can't run sessions right now, if it can't. */
export function useProviderProblem(
  provider: AgentProvider = "claude",
): ProviderProblem | undefined {
  return useAppStore((s) => problemOf(s.engineStatus, provider));
}

/**
 * Whether a session can be started with `provider` from here: its CLI is installed and
 * recent enough (a logged-out one, or Cursor without a valid key, still counts: its
 * connect steps say what to do). Demo mode only runs Claude Code.
 */
export function canStartWith(status: EngineStatus | undefined, provider: AgentProvider): boolean {
  if (!status) return false;
  if (status.demo) return provider === "claude";
  const p = providerStatus(status, provider);
  return Boolean(p?.found && !p.outdated);
}

export const useCanStartWith = (provider: AgentProvider): boolean =>
  useAppStore((s) => canStartWith(s.engineStatus, provider));

/** The agents a session can be started with from here, in `AGENT_PROVIDERS` order. */
export function useOfferedProviders(): readonly AgentProvider[] {
  // Joined so the selector returns a stable value; split once per change.
  const offered = useAppStore((s) =>
    AGENT_PROVIDERS.filter((p) => canStartWith(s.engineStatus, p)).join(","),
  );
  return useMemo(() => AGENT_PROVIDERS.filter((p) => offered.split(",").includes(p)), [offered]);
}

/**
 * What Gravita says about an optional agent (Codex, Cursor): "missing" once the engine
 * looked and found none, else "outdated" when it is older than Gravita supports. Unlike
 * `problemOf` an engine that doesn't look for it says nothing; never in demo mode.
 */
export function optionalNoteOf(
  status: EngineStatus | undefined,
  provider: Exclude<AgentProvider, "claude">,
): Extract<ProviderProblem, "missing" | "outdated"> | undefined {
  const p = status && !status.demo ? status.providers?.[provider] : undefined;
  if (!p) return undefined;
  if (!p.found) return "missing";
  return p.outdated ? "outdated" : undefined;
}

export const codexNoteOf = (status: EngineStatus | undefined) => optionalNoteOf(status, "codex");

export const useCodexNote = () => useAppStore((s) => codexNoteOf(s.engineStatus));
export const useCursorNote = () => useAppStore((s) => optionalNoteOf(s.engineStatus, "cursor"));

/**
 * The Cursor key's standing as the engine reports it (never the key): undefined where
 * the engine doesn't run Cursor (not found, demo, an older engine).
 */
export const useCursorCredential = (): ProviderStatus["credential"] =>
  useAppStore((s) =>
    s.engineStatus?.demo || !s.engineStatus?.providers?.cursor?.found
      ? undefined
      : s.engineStatus.providers.cursor.credential,
  );

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
export function useUsageRefresh(provider: AgentProvider | null = "claude") {
  const refresh = useAppStore((s) => s.refreshUsage);
  const connection = useConnection();
  useEffect(() => {
    // null: nothing to read (a caller that needs a provider only sometimes).
    if (provider && connection === "online") void refresh(provider);
  }, [refresh, connection, provider]);
}

/**
 * Gravita's own Codex profile, which squads run Codex in: undefined until the engine
 * looked (or where it can't run Codex).
 */
export const useCodexProfile = (): CodexProfileStatus | undefined =>
  useAppStore((s) =>
    s.engineStatus?.demo ? undefined : s.engineStatus?.providers?.codex?.squadProfile,
  );

/** Asks the engine to read the Codex profile while the caller is mounted (and online). */
export function useCodexProfileRefresh(enabled: boolean) {
  const read = useAppStore((s) => s.readCodexProfile);
  const connection = useConnection();
  useEffect(() => {
    if (enabled && connection === "online") void read();
  }, [read, connection, enabled]);
}

/** Whether this engine can open terminals (not on Windows yet, nor an older engine). */
export const useTerminalSupported = (): boolean =>
  useAppStore((s) => s.engineStatus?.terminal === true);

/** The newer release the engine found, if any: its version and its page. */
export const useAvailableUpdate = (): NonNullable<EngineStatus["update"]> | undefined =>
  useAppStore((s) => s.engineStatus?.update);

/** The version of the engine, and so of the app, once the engine has said (older ones don't). */
export const useEngineVersion = (): string | undefined =>
  useAppStore((s) => s.engineStatus?.version);

export const useTerminal = (terminalId: string): TerminalInfo | undefined =>
  useAppStore((s) => s.terminals[terminalId]);

/** The terminal a session runs in: the running one, else the latest. */
export function terminalOfSession(
  terminals: Record<string, TerminalInfo>,
  sessionId: string,
): TerminalInfo | undefined {
  let best: TerminalInfo | undefined;
  for (const t of Object.values(terminals)) {
    if (t.sessionId !== sessionId) continue;
    if (
      !best ||
      (t.running && !best.running) ||
      (t.running === best.running && t.startedAt > best.startedAt)
    )
      best = t;
  }
  return best;
}

/** The agent a terminal runs, if any (see `terminalProvider`). */
export const useTerminalProvider = (terminal: TerminalInfo): AgentProvider | undefined =>
  useAppStore((s) => terminalProvider(terminal, s.projection.sessions));

export const useSessionTerminal = (sessionId: string): TerminalInfo | undefined =>
  useAppStore((s) => terminalOfSession(s.terminals, sessionId));

/** Store actions for terminals. */
export function useTerminalControl() {
  return {
    spawn: useAppStore((s) => s.spawnTerminal),
    kill: useAppStore((s) => s.killTerminal),
  };
}
