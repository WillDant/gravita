import { sessionCounts } from "@gravita/core";
import { ChevronRight, Terminal } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useNavigate } from "@/app/providers";
import { t, useLocale } from "@/shared/i18n/i18n";
import { sessionTitle } from "@/shared/presenters/selectors";
import { CountChips } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useNow, useProjection, useSessionEvents, useStartingSessionId } from "@/state/hooks";
import { AgentPanel } from "./agent-panel/AgentPanel";
import { Composer } from "./composer/Composer";
import { Happening } from "./happening/Happening";
import { LineMap } from "./line-map/LineMap";
import { TreeLens } from "./tree-lens/TreeLens";

// The Conversation and Orbit lenses (renderer, canvas scene and all) load on first open,
// off the initial bundle.
const ConversationLens = lazy(() => import("./conversation/ConversationLens"));
const OrbitLens = lazy(() => import("./orbit-lens/OrbitLens"));

const LENSES = ["lines", "orbit", "conversation", "tree"] as const;
type Lens = (typeof LENSES)[number];

export function Session({
  projectId,
  sessionId,
  agentId,
}: {
  projectId: string;
  sessionId: string;
  agentId?: string;
}) {
  useLocale();
  const session = useProjection((p) => p.sessions[sessionId]);
  const project = useProjection((p) => p.projects[projectId]);
  const events = useSessionEvents(sessionId);
  const now = useNow();
  const navigate = useNavigate();
  const [lens, setLens] = useState<Lens>("lines");
  const starting = useStartingSessionId();

  if (!session || !project) {
    return starting === sessionId ? (
      <p role="status" className="p-8 text-ink-2">
        {t("session.starting")}
      </p>
    ) : null;
  }
  const select = (id?: string) =>
    navigate({ level: "session", projectId, sessionId, ...(id ? { agentId: id } : {}) });
  const selected = agentId ? session.agents[agentId] : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <button
            type="button"
            className="text-ink-2 hover:text-ink"
            onClick={() => navigate({ level: "home" })}
          >
            {t("nav.home")}
          </button>
          <ChevronRight size={14} className="text-ink-3" aria-hidden="true" />
          <button
            type="button"
            className="truncate text-ink-2 hover:text-ink"
            onClick={() => navigate({ level: "project", projectId })}
          >
            {project.name}
          </button>
          <ChevronRight size={14} className="text-ink-3" aria-hidden="true" />
          <span className="truncate font-semibold text-ink" aria-current="page">
            {sessionTitle(session) ?? t("session.untitled")}
          </span>
        </nav>
        <div role="tablist" aria-label="Lens" className="flex rounded-lg bg-panel p-0.5">
          {LENSES.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={lens === l}
              onClick={() => setLens(l)}
              className={cn(
                "h-7 rounded-md px-3 text-sm font-medium text-ink-2 transition-colors",
                lens === l ? "bg-ground text-ink shadow-panel" : "hover:text-ink",
              )}
            >
              {t(`session.lens.${l}`)}
            </button>
          ))}
        </div>
        <CountChips counts={sessionCounts(session, now)} scope="session" className="ml-auto" />
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {lens === "lines" && (
              <LineMap
                session={session}
                events={events}
                now={now}
                selectedAgentId={agentId}
                onSelectAgent={select}
              />
            )}
            {lens === "orbit" && (
              <Suspense fallback={null}>
                <OrbitLens
                  session={session}
                  project={project}
                  now={now}
                  selectedAgentId={agentId}
                  onSelect={select}
                />
              </Suspense>
            )}
            {lens === "conversation" && (
              <Suspense fallback={null}>
                <ConversationLens session={session} onSelect={select} />
              </Suspense>
            )}
            {lens === "tree" && (
              <TreeLens session={session} now={now} selectedAgentId={agentId} onSelect={select} />
            )}
          </div>
          {session.controllable ? (
            <Composer session={session} />
          ) : (
            session.kind === "external" && (
              <div className="flex flex-none items-center gap-2 border-t border-hairline bg-panel px-6 py-2.5 text-sm text-ink-2">
                <Terminal size={15} aria-hidden="true" />
                {t("session.watching")}
                <span className="ml-auto truncate text-xs text-ink-3">{session.cwd}</span>
              </div>
            )
          )}
        </div>

        <aside className="relative flex w-[340px] flex-none flex-col border-l border-hairline">
          {selected ? (
            <AgentPanel
              session={session}
              agent={selected}
              events={events}
              now={now}
              onClose={() => select()}
              onSelect={select}
            />
          ) : (
            <Happening session={session} now={now} onSelect={select} />
          )}
        </aside>
      </div>
    </div>
  );
}
