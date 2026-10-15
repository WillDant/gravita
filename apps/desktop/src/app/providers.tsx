import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import type { EngineGateway } from "@/infrastructure/engine/EngineGateway";
import {
  type CursorKeyBridge,
  createReleaseOpener,
  createSignInOpener,
  type OpenRelease,
  type OpenSignIn,
  type PickFolder,
} from "@/infrastructure/platform/tauri";
import type {
  NotificationPrefs,
  NotificationPrefsStore,
} from "@/infrastructure/preferences/notificationPrefs";
import type {
  ProjectAppearance,
  ProjectAppearancePatch,
  ProjectAppearanceStore,
  ProjectAppearances,
} from "@/infrastructure/preferences/projectAppearance";
import { StoreContext } from "@/state/hooks";
import type { Route } from "@/state/slices/route";
import type { AppStore } from "@/state/store";

/** What the composition root hands to the React tree. */
export interface AppServices {
  store: AppStore;
  gateway: EngineGateway;
  navigate: (route: Route) => void;
  toggleTheme: () => void;
  /** The native folder picker; absent in the browser, where the folder is typed. */
  pickFolder?: PickFolder;
  /** Opens Codex's sign-in link in the user's browser (a default one when absent). */
  openSignIn?: OpenSignIn;
  /** Opens a release page in the user's browser (a default one when absent). */
  openRelease?: OpenRelease;
  /** Where the Cursor key is stored; absent in the browser, where it can't be set. */
  cursorKey?: CursorKeyBridge;
  /** Which OS notifications to send while Gravita is in the background. */
  notificationPrefs: NotificationPrefsStore;
  /** How each project's tile looks (its icon and colour). */
  projectAppearance: ProjectAppearanceStore;
}

const GatewayContext = createContext<EngineGateway | null>(null);
const NavigateContext = createContext<((route: Route) => void) | null>(null);
const ThemeContext = createContext<(() => void) | null>(null);
const PickFolderContext = createContext<PickFolder | undefined>(undefined);
const OpenSignInContext = createContext<OpenSignIn>(createSignInOpener());
const OpenReleaseContext = createContext<OpenRelease>(createReleaseOpener());
const CursorKeyContext = createContext<CursorKeyBridge | undefined>(undefined);
const NotificationPrefsContext = createContext<NotificationPrefsStore | null>(null);
const ProjectAppearanceContext = createContext<ProjectAppearanceStore | null>(null);

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new Error(`${name} is missing: wrap the app in <AppProviders>`);
  return value;
}

export function AppProviders({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return (
    <StoreContext.Provider value={services.store}>
      <GatewayContext.Provider value={services.gateway}>
        <NavigateContext.Provider value={services.navigate}>
          <ThemeContext.Provider value={services.toggleTheme}>
            <PickFolderContext.Provider value={services.pickFolder}>
              <OpenSignInContext.Provider value={services.openSignIn ?? createSignInOpener()}>
                <OpenReleaseContext.Provider value={services.openRelease ?? createReleaseOpener()}>
                  <CursorKeyContext.Provider value={services.cursorKey}>
                    <NotificationPrefsContext.Provider value={services.notificationPrefs}>
                      <ProjectAppearanceContext.Provider value={services.projectAppearance}>
                        {children}
                      </ProjectAppearanceContext.Provider>
                    </NotificationPrefsContext.Provider>
                  </CursorKeyContext.Provider>
                </OpenReleaseContext.Provider>
              </OpenSignInContext.Provider>
            </PickFolderContext.Provider>
          </ThemeContext.Provider>
        </NavigateContext.Provider>
      </GatewayContext.Provider>
    </StoreContext.Provider>
  );
}

export const useGateway = (): EngineGateway => required(useContext(GatewayContext), "Gateway");
export const useNavigate = (): ((route: Route) => void) =>
  required(useContext(NavigateContext), "Router");
export const useToggleTheme = (): (() => void) => required(useContext(ThemeContext), "Theme");
export const usePickFolder = (): PickFolder | undefined => useContext(PickFolderContext);
export const useOpenSignIn = (): OpenSignIn => useContext(OpenSignInContext);
export const useOpenRelease = (): OpenRelease => useContext(OpenReleaseContext);
export const useCursorKeyBridge = (): CursorKeyBridge | undefined => useContext(CursorKeyContext);

/** The notification preferences and their setter (persisted by the store). */
export function useNotificationPrefs(): [
  NotificationPrefs,
  (patch: Partial<NotificationPrefs>) => void,
] {
  const store = required(useContext(NotificationPrefsContext), "NotificationPrefs");
  const prefs = useSyncExternalStore(store.subscribe, store.get);
  return [prefs, store.set];
}

/** A project's tile look and the setters for it (persisted by the store). */
export function useProjectAppearance(projectId: string): {
  appearance: ProjectAppearance | undefined;
  set: (patch: ProjectAppearancePatch) => void;
  reset: () => void;
} {
  const store = required(useContext(ProjectAppearanceContext), "ProjectAppearance");
  const all = useSyncExternalStore(store.subscribe, store.get);
  return {
    appearance: all[projectId],
    set: (patch) => store.set(projectId, patch),
    reset: () => store.reset(projectId),
  };
}

/** Every project's tile look, for lists. */
export function useProjectAppearances(): ProjectAppearances {
  const store = required(useContext(ProjectAppearanceContext), "ProjectAppearance");
  return useSyncExternalStore(store.subscribe, store.get);
}

export type Theme = "light" | "dark";

const subscribeTheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

/** The theme on screen now (the user's choice or the OS's): follows every change. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, currentTheme);
}
