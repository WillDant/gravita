import type { AgentNode, SessionState } from "@gravita/core";
import { toPersona } from "@gravita/core";
import { agentColor } from "@gravita/orbs";
import { Orb } from "@/features/agents/Orb";
import { PermissionActions } from "@/features/permissions/PermissionActions";
import { QuestionCard } from "@/features/questions/QuestionCard";
import { firstQuestion } from "@/features/questions/questions";
import { ago, t } from "@/shared/i18n/i18n";
import { agentName, permissionSummary, toolShort } from "@/shared/presenters/agent";
import { liveAgents } from "@/shared/presenters/selectors";
import { cn } from "@/shared/utils";

/** Side panel when no agent is selected: who's working now, then who worked recently. */
export function Happening({
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
  const question = waiting ? firstQuestion(agent) : undefined;
  const asks = waiting && !question ? permissionSummary(agent) : undefined;
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
      {question ? (
        <QuestionCard session={session} agent={agent} pending={question} className="px-3 pt-1" />
      ) : (
        waiting && <PermissionActions session={session} agent={agent} className="pl-[52px]" />
      )}
    </li>
  );
}
