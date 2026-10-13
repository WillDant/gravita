import { createContext, type ReactNode, useContext } from "react";
import type { EngineGateway } from "@/infrastructure/engine/EngineGateway";
import type { PickFolder } from "@/infrastructure/platform/tauri";
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
}

const GatewayContext = createContext<EngineGateway | null>(null);
const NavigateContext = createContext<((route: Route) => void) | null>(null);
const ThemeContext = createContext<(() => void) | null>(null);
const PickFolderContext = createContext<PickFolder | undefined>(undefined);

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
              {children}
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
