import {
  type AgentNode,
  effectiveLifecycle,
  type SessionState,
  sessionCounts,
  toPersona,
} from "@gravita/core";
import { ChevronRight, Terminal } from "lucide-react";
import { useState } from "react";
import { AgentPanel } from "@/components/AgentPanel";
import { agentName, LineMap } from "@/components/LineMap";
import { Orb } from "@/components/Orb";
import { PermissionActions, permissionSummary } from "@/components/PermissionActions";
import { CountChips } from "@/components/ui";
import { ago, t, useLocale } from "@/lib/i18n";
import { agentColor } from "@/lib/palette";
import { liveAgents, sessionTitle } from "@/lib/selectors";
import { basename, cn } from "@/lib/utils";
import { useStore } from "@/store";

type Lens = "lines" | "tree";

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
  const state = useStore((s) => s.state);
  useStore((s) => s.rev);
  const now = useStore((s) => s.now);
  const open = useStore((s) => s.openSession);
  const navigate = useStore((s) => s.navigate);
  const [lens, setLens] = useState<Lens>("lines");
  const session = state.sessions[sessionId];
  const project = state.projects[projectId];

  if (!session || !project) return null;
  const select = (id?: string) =>
    navigate({ level: "session", projectId, sessionId, ...(id ? { agentId: id } : {}) });
  const events = open?.id === sessionId ? open.events : [];
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
          {(["lines", "tree"] as const).map((l) => (
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
            {lens === "lines" ? (
              <LineMap
                session={session}
                events={events}
                now={now}
                selectedAgentId={agentId}
                onSelectAgent={select}
              />
            ) : (
              <TreeLens session={session} now={now} selectedAgentId={agentId} onSelect={select} />
            )}
          </div>
          {session.kind === "external" && (
            <div className="flex flex-none items-center gap-2 border-t border-hairline bg-panel px-6 py-2.5 text-sm text-ink-2">
              <Terminal size={15} aria-hidden="true" />
              {t("session.watching")}
              <span className="ml-auto truncate text-xs text-ink-3">{session.cwd}</span>
            </div>
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

function Happening({
  session,
  now,
  onSelect,
}: {
  session: SessionState;
  now: number;
  onSelect: (id: string) => void;
}) {
  const live = liveAgents(session, now);
  const recent = Object.values(session.agents)
    .filter((a) => !live.includes(a))
    .sort((a, b) => b.lastEventTs.localeCompare(a.lastEventTs))
    .slice(0, 6);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="flex-none px-5 pt-4 pb-2 text-sm font-semibold">{t("session.happening")}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {live.length === 0 && (
          <p className="px-2 py-2 text-sm text-ink-2">{t("session.happeningEmpty")}</p>
        )}
        <ul className="flex flex-col gap-1">
          {live.map((a) => (
            <AgentRow key={a.id} agent={a} session={session} now={now} onSelect={onSelect} />
          ))}
        </ul>
        {recent.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 border-t border-hairline pt-3">
            {recent.map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                session={session}
                now={now}
                onSelect={onSelect}
                quiet
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  session,
  now,
  onSelect,
  quiet,
}: {
  agent: AgentNode;
  session: SessionState;
  now: number;
  onSelect: (id: string) => void;
  quiet?: boolean;
}) {
  const persona = toPersona(agent, session, now);
  const waiting = persona.lifecycle === "waiting_user";
  const asks = waiting ? permissionSummary(agent) : undefined;
  return (
    <li className={cn("rounded-lg", waiting && "bg-waiting-bg pb-2")}>
      <button
        type="button"
        onClick={() => onSelect(agent.id)}
        className={cn(
          "flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors",
          waiting ? "hover:bg-waiting/10" : "hover:bg-panel",
        )}
      >
        <Orb
          color={agentColor(agent.agentType)}
          persona={persona}
          size={quiet ? 26 : 32}
          glyph={!quiet}
        />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm leading-snug", quiet ? "text-ink-2" : "text-ink")}>
            <span className="font-semibold">{agentName(agent)}</span>{" "}
            {t(persona.label.key, persona.label.params)}
          </span>
          <span
            className={cn(
              "mt-0.5 block truncate text-xs",
              asks ? "font-mono text-waiting-ink" : "text-ink-3",
            )}
          >
            {asks ??
              agent.description ??
              (agent.lastTool ? toolShort(agent.lastTool) : ago(agent.lastEventTs, now))}
          </span>
        </span>
      </button>
      {waiting && <PermissionActions session={session} agent={agent} className="pl-[52px]" />}
    </li>
  );
}

function TreeLens({
  session,
  now,
  selectedAgentId,
  onSelect,
}: {
  session: SessionState;
  now: number;
  selectedAgentId?: string;
  onSelect: (id: string) => void;
}) {
  const render = (a: AgentNode, depth: number): React.ReactNode => {
    const persona = toPersona(a, session, now);
    const lc = effectiveLifecycle(a, session, now);
    return (
      <li key={a.id}>
        <button
          type="button"
          onClick={() => onSelect(a.id)}
          aria-current={selectedAgentId === a.id ? "true" : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg py-1.5 pr-3 text-left hover:bg-panel",
            selectedAgentId === a.id && "bg-select",
          )}
          style={{ paddingLeft: 12 + depth * 28 }}
        >
          <Orb color={agentColor(a.agentType)} persona={persona} size={28} glyph={false} />
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold">{agentName(a)}</span>{" "}
            <span className={lc === "active" || lc === "waiting_user" ? "text-ink" : "text-ink-3"}>
              {t(persona.label.key, persona.label.params)}
            </span>
          </span>
          <span className="flex-none text-xs text-ink-3 tabular">{a.toolCount}</span>
        </button>
        {a.children.length > 0 && (
          <ul>
            {a.children
              .map((c) => session.agents[c])
              .filter((c): c is AgentNode => Boolean(c))
              .map((c) => render(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };
  const main = session.agents.main;
  return <ul className="h-full overflow-y-auto p-4">{main ? render(main, 0) : null}</ul>;
}

function toolShort(tool: NonNullable<AgentNode["lastTool"]>): string {
  const t = tool.target;
  return t.path ? basename(t.path) : (t.cmd ?? t.query ?? t.url ?? tool.inputPreview);
}
