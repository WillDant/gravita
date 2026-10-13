import { type AgentNode, buildLineMap, type SessionState, toPersona } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { Orb } from "@/features/agents/Orb";
import { PermissionActions } from "@/features/permissions/PermissionActions";
import { ago, compact, t } from "@/shared/i18n/i18n";
import { agentColor } from "@/shared/palette";
import { agentName, permissionSummary } from "@/shared/presenters/agent";
import { basename, cn } from "@/shared/utils";
import { Steps, Story } from "./Timeline";

type Tab = "story" | "steps" | "raw";

interface AgentPanelProps {
  session: SessionState;
  agent: AgentNode;
  events: GravitaEvent[];
  now: number;
  onClose: () => void;
  onSelect: (agentId: string) => void;
}

/** The agent side panel: who it is, what it's doing, and what it did (Story → Steps → Raw). */
export function AgentPanel({ session, agent, events, now, onClose, onSelect }: AgentPanelProps) {
  const [tab, setTab] = useState<Tab>("story");
  const persona = toPersona(agent, session, now);
  const color = agentColor(agent.agentType);
  const line = useMemo(
    () => buildLineMap(events).lines.find((l) => l.agentId === agent.id),
    [events, agent.id],
  );
  const stations = line?.stations ?? [];
  const tokens = agent.tokens.input + agent.tokens.output + agent.tokens.cacheWrite;
  const children = agent.children
    .map((c) => session.agents[c])
    .filter((c): c is AgentNode => Boolean(c));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-start gap-3 border-b border-hairline px-5 pt-4 pb-4">
        <Orb color={color} persona={persona} size={48} label={agentName(agent)} />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="truncate text-md font-bold tracking-[-0.01em]">{agentName(agent)}</h2>
          <p
            className={cn(
              "text-sm leading-snug",
              persona.lifecycle === "waiting_user" ? "text-waiting-ink" : "text-ink-2",
            )}
          >
            {t(persona.label.key, persona.label.params)}
          </p>
          {agent.description && (
            <p className="mt-1 truncate text-xs text-ink-3">{agent.description}</p>
          )}
          {persona.lifecycle === "waiting_user" && (
            <div className="mt-3 flex flex-col gap-2">
              {permissionSummary(agent) && (
                <p className="rounded-md bg-waiting-bg px-2 py-1.5 font-mono text-xs break-all text-waiting-ink">
                  {permissionSummary(agent)}
                </p>
              )}
              <PermissionActions session={session} agent={agent} />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("agent.close")}
          className="rounded-md p-1.5 text-ink-3 hover:bg-panel hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>

      <dl className="grid flex-none grid-cols-3 gap-2 border-b border-hairline px-5 py-3 text-xs">
        <div>
          <dt className="text-ink-3">{t("agent.toolCalls")}</dt>
          <dd className="mt-0.5 text-sm font-medium tabular">{agent.toolCount}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("agent.tokens")}</dt>
          <dd className="mt-0.5 text-sm font-medium tabular">{compact(tokens)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">{t("agent.startedLabel")}</dt>
          <dd className="mt-0.5 text-sm font-medium">{ago(agent.createdTs, now)}</dd>
        </div>
      </dl>

      <div role="tablist" aria-label={agentName(agent)} className="flex flex-none gap-1 px-4 pt-3">
        {(["story", "steps", "raw"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "h-7 rounded-md px-2.5 text-sm font-medium transition-colors",
              tab === k ? "bg-panel text-ink" : "text-ink-3 hover:text-ink",
            )}
          >
            {t(`agent.tabs.${k}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">
        {tab === "story" && <Story stations={stations} color={color.line} />}
        {tab === "steps" && <Steps stations={stations} color={color.line} />}
        {tab === "raw" && (
          <pre className="overflow-x-auto rounded-lg bg-panel p-3 font-mono text-[11px] leading-relaxed text-ink-2">
            {JSON.stringify({ ...agent, inflight: Object.keys(agent.inflight) }, null, 2)}
          </pre>
        )}

        {children.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-2 text-xs font-semibold text-ink-3">{t("agent.subagents")}</h3>
            <ul className="flex flex-col gap-1">
              {children.map((c) => {
                const p = toPersona(c, session, now);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-panel"
                    >
                      <Orb color={agentColor(c.agentType)} persona={p} size={24} glyph={false} />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-semibold">{c.agentType}</span>{" "}
                        <span className="text-ink-2">{t(p.label.key, p.label.params)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {agent.filesTouched.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-2 text-xs font-semibold text-ink-3">{t("agent.files")}</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {agent.filesTouched.map((f) => (
                <li key={f} title={f} className="truncate font-mono text-xs text-ink-2">
                  {basename(f)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
