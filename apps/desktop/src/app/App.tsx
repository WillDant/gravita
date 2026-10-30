import { lazy, Suspense, useEffect } from "react";
import { CommandPalette } from "@/features/command-palette/CommandPalette";
import { useCommandPaletteHotkey } from "@/features/command-palette/useCommandPaletteHotkey";
import { Home } from "@/features/home/Home";
import { Sidebar } from "@/features/navigation/Sidebar";
import { NoticeLine } from "@/features/notice/NoticeLine";
import { Project } from "@/features/project/Project";
import { Session } from "@/features/session/Session";
import { Settings } from "@/features/settings/Settings";
import { TerminalScreen } from "@/features/terminal/TerminalScreen";
import { TerminalsScreen } from "@/features/terminals/TerminalsScreen";
import { UpdateToast } from "@/features/update/UpdateToast";
import { t, useLocale } from "@/shared/i18n/i18n";
import { useConnection, useIsDemo, useProjection, useRoute } from "@/state/hooks";

// Squads load on first open, off the initial bundle.
const SquadScreen = lazy(() => import("@/features/squad/SquadScreen"));

// Dev-only: production builds fold this to undefined, so the gallery never ships.
const PersonaGallery = import.meta.env.DEV
  ? lazy(() =>
      import("@/features/gallery/PersonaGallery").then((m) => ({ default: m.PersonaGallery })),
    )
  : undefined;
const SquadGallery = import.meta.env.DEV
  ? lazy(() => import("@/features/gallery/SquadGallery").then((m) => ({ default: m.SquadGallery })))
  : undefined;

export function App() {
  useLocale();
  const route = useRoute();
  const connection = useConnection();
  const demo = useIsDemo();
  const hasData = useProjection((p) => Object.keys(p.sessions).length > 0);
  useCommandPaletteHotkey();

  useEffect(() => {
    document.title = "Gravita";
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col bg-ground">
        <div data-tauri-drag-region className="h-7 flex-none" />
        {connection === "offline" && (
          <div
            role="status"
            className="flex-none border-b border-waiting/30 bg-waiting-bg px-6 py-2 text-sm text-waiting-ink"
          >
            {t("engine.offline")}
          </div>
        )}
        <NoticeLine />
        <UpdateToast />
        <CommandPalette />
        {demo && (
          <div className="pointer-events-none absolute right-4 bottom-3 z-10 rounded-full bg-panel px-2.5 py-1 text-2xs font-medium text-ink-3">
            {t("engine.demo")}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {connection === "connecting" && !hasData ? (
            <p className="p-8 text-ink-2">{t("engine.connecting")}</p>
          ) : route.level === "home" ? (
            <Home />
          ) : route.level === "terminals" ? (
            <TerminalsScreen {...(route.terminalId ? { terminalId: route.terminalId } : {})} />
          ) : route.level === "settings" ? (
            <Settings />
          ) : route.level === "project" ? (
            <Project projectId={route.projectId} />
          ) : route.level === "squad" ? (
            <Suspense
              fallback={
                <p role="status" className="p-8 text-ink-2">
                  {t("squad.loading")}
                </p>
              }
            >
              <SquadScreen
                key={route.squadId}
                projectId={route.projectId}
                squadId={route.squadId}
                {...(route.taskId ? { taskId: route.taskId } : {})}
              />
            </Suspense>
          ) : route.level === "terminal" ? (
            <TerminalScreen
              key={route.terminalId}
              projectId={route.projectId}
              terminalId={route.terminalId}
            />
          ) : route.level === "gallery" ? (
            route.squad && SquadGallery ? (
              <Suspense>
                <SquadGallery fixture={route.squad} />
              </Suspense>
            ) : (
              PersonaGallery && (
                <Suspense>
                  <PersonaGallery />
                </Suspense>
              )
            )
          ) : (
            <Session
              projectId={route.projectId}
              sessionId={route.sessionId}
              agentId={route.agentId}
            />
          )}
        </div>
      </main>
    </div>
  );
}
