import { toPersona } from "@gravita/core";
import { useMemo } from "react";
import { agentName } from "@/components/LineMap";
import { MiniLines } from "@/components/MiniLines";
import { Orb } from "@/components/Orb";
import { PermissionActions, permissionSummary } from "@/components/PermissionActions";
import { CountChips } from "@/components/ui";
import { ago, t, useLocale } from "@/lib/i18n";
import { agentColor } from "@/lib/palette";
import { needsYou, projectSummaries, sessionTitle, totals } from "@/lib/selectors";
import { tildify } from "@/lib/utils";
import { useStore } from "@/store";

export function Home() {
  useLocale();
  const state = useStore((s) => s.state);
  useStore((s) => s.rev);
  const now = useStore((s) => s.now);
  const navigate = useStore((s) => s.navigate);
  const summaries = useMemo(() => projectSummaries(state, now), [state, now]);
  const waiting = needsYou(state, now);
  const all = totals(summaries);
  const running = summaries.flatMap(({ project, live }) =>
    live
      .filter(({ agent }) => agent.lifecycle !== "waiting_user")
      .map(({ session, agent }) => ({ project, session, agent })),
  );

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-10 px-8 pt-8 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">{t("home.title")}</h1>
          {all.running + all.waiting === 0 && (
            <p className="mt-1.5 text-ink-2">{t("home.allQuiet")}</p>
          )}
        </div>
        <CountChips counts={all} />
      </header>

      {waiting.length > 0 && (
        <section aria-labelledby="needs-you">
          <h2 id="needs-you" className="mb-3 text-md font-semibold">
            {t("home.needsYou")}
          </h2>
          <ul className="flex flex-col gap-2">
            {waiting.map(({ project, session, agent }) => {
              const persona = toPersona(agent, session, now);
              const asks = permissionSummary(agent);
              return (
                <li
                  key={`${session.id}:${agent.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-waiting/40 bg-waiting-bg py-3 pr-4 pl-4"
                >
                  <button
                    type="button"
                    onClick={() =>
                      navigate({
                        level: "session",
                        projectId: project.id,
                        sessionId: session.id,
                        agentId: agent.id,
                      })
                    }
                    className="flex min-w-[280px] flex-1 items-center gap-3 text-left"
                  >
                    <Orb color={agentColor(agent.agentType)} persona={persona} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-ink-2">
                        {project.name} › {sessionTitle(session) ?? t("session.untitled")}
                      </span>
                      <span className="block truncate font-medium text-ink">
                        {agentName(agent)} {t(persona.label.key, persona.label.params)}
                      </span>
                      {asks && (
                        <span className="block truncate font-mono text-xs text-waiting-ink">
                          {asks}
                        </span>
                      )}
                    </span>
                  </button>
                  <PermissionActions session={session} agent={agent} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {running.length > 0 && (
        <section aria-labelledby="running-now">
          <h2 id="running-now" className="mb-3 text-md font-semibold">
            {t("home.now")}
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-6 gap-y-1">
            {running.slice(0, 8).map(({ project, session, agent }) => {
              const persona = toPersona(agent, session, now);
              return (
                <li key={`${session.id}:${agent.id}`}>
                  <button
                    type="button"
                    onClick={() =>
                      navigate({
                        level: "session",
                        projectId: project.id,
                        sessionId: session.id,
                        agentId: agent.id,
                      })
                    }
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-panel"
                  >
                    <Orb
                      color={agentColor(agent.agentType)}
                      persona={persona}
                      size={30}
                      glyph={false}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        <span className="font-semibold">{agentName(agent)}</span>{" "}
                        {t(persona.label.key, persona.label.params)}
                      </span>
                      <span className="block truncate text-xs text-ink-3">
                        {project.name} › {sessionTitle(session) ?? t("session.untitled")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {running.length > 8 && (
            <p className="mt-2 px-2 text-xs text-ink-3">
              {t("home.moreLive", { count: running.length - 8 })}
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="projects">
        <h2 id="projects" className="mb-3 text-md font-semibold">
          {t("home.projects")}
        </h2>
        <div className="overflow-hidden rounded-xl border border-hairline">
          {summaries.map(({ project, sessions, counts, lastEventTs }, i) => {
            const quiet = counts.running + counts.waiting === 0;
            const recent = sessions[0];
            return (
              <button
                type="button"
                key={project.id}
                onClick={() => navigate({ level: "project", projectId: project.id })}
                className={`grid w-full grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-panel ${i > 0 ? "border-t border-hairline" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{project.name}</span>
                  <span className="block truncate text-xs text-ink-3">{tildify(project.root)}</span>
                </span>
                <span className="min-w-0">
                  {recent && <MiniLines session={recent} now={now} />}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-medium ${counts.waiting > 0 ? "text-waiting-ink" : quiet ? "text-ink-3" : "text-ink"}`}
                  >
                    {counts.waiting > 0
                      ? t("count.waiting", { count: counts.waiting })
                      : quiet
                        ? t("home.status.quiet")
                        : `${t("count.running", { count: counts.running })} · ${t("count.subagents", { count: counts.subagents })}`}
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {recent ? (sessionTitle(recent) ?? t("session.untitled")) : ""}
                  </span>
                </span>
                <span className="text-right text-xs text-ink-3 tabular-nums">
                  {ago(lastEventTs, now)}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
