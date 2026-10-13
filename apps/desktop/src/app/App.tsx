import { useEffect } from "react";
import { Home } from "@/features/home/Home";
import { Sidebar } from "@/features/navigation/Sidebar";
import { Project } from "@/features/project/Project";
import { Session } from "@/features/session/Session";
import { t, useLocale } from "@/shared/i18n/i18n";
import { useConnection, useIsDemo, useProjection, useRoute } from "@/state/hooks";

export function App() {
  useLocale();
  const route = useRoute();
  const connection = useConnection();
  const demo = useIsDemo();
  const hasData = useProjection((p) => Object.keys(p.sessions).length > 0);

  useEffect(() => {
    document.title = "Gravita";
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        {connection === "offline" && (
          <div
            role="status"
            className="flex-none border-b border-waiting/30 bg-waiting-bg px-6 py-2 text-sm text-waiting-ink"
          >
            {t("engine.offline")}
          </div>
        )}
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
          ) : route.level === "project" ? (
            <Project projectId={route.projectId} />
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
