import { type AgentNode, effectiveLifecycle, type SessionState, toPersona } from "@gravita/core";
import { agentColor } from "@gravita/orbs";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import type { ReactNode } from "react";
import { Orb } from "@/features/agents/Orb";
import { t } from "@/shared/i18n/i18n";
import { agentName } from "@/shared/presenters/agent";
import { cn } from "@/shared/utils";

/** The session as an indented tree of agents, main first. */
export function TreeLens({
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
  const render = (a: AgentNode, depth: number): ReactNode => {
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
  const main = session.agents[MAIN_AGENT];
  return <ul className="h-full overflow-y-auto p-4">{main ? render(main, 0) : null}</ul>;
}
