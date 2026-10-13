import { useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { t, useLocale } from "@/lib/i18n";
import { Home } from "@/screens/Home";
import { Project } from "@/screens/Project";
import { Session } from "@/screens/Session";
import { useStore } from "@/store";

export function App() {
  useLocale();
  const route = useStore((s) => s.route);
  const connection = useStore((s) => s.connection);
  const demo = useStore((s) => s.engineStatus?.demo);
  const hasData = useStore((s) => Object.keys(s.state.sessions).length > 0);

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
