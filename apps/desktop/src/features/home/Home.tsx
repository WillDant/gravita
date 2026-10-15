import { toPersona } from "@gravita/core";
import { agentColor } from "@gravita/orbs";
import { AGENT_PROVIDERS } from "@gravita/protocol/constants";
import { Activity, FolderKanban, Hand } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useProjectAppearances } from "@/app/providers";
import { MiniLines } from "@/features/agents/MiniLines";
import { Orb } from "@/features/agents/Orb";
import { CodexNote } from "@/features/connect/CodexNote";
import { ConnectProvider } from "@/features/connect/ConnectProvider";
import { NewSessionButton, NewSessionPanel } from "@/features/new-session/NewSessionPanel";
import { NewSquadButton, NewSquadPanel } from "@/features/new-squad/NewSquadPanel";
import { PermissionActions } from "@/features/permissions/PermissionActions";
import { firstQuestion } from "@/features/questions/questions";
import { SquadDecisionRow } from "@/features/squad-row/SquadDecisionRow";
import { PlanUsage } from "@/features/usage/PlanUsageLine";
import { ago, t, useLocale } from "@/shared/i18n/i18n";
import { agentName, permissionSummary } from "@/shared/presenters/agent";
import { needsYou, projectSummaries, sessionTitle, totals } from "@/shared/presenters/selectors";
import { squadNeedsYou } from "@/shared/presenters/squad";
import { ProjectTile } from "@/shared/ui/ProjectTile";
import { ProviderMark } from "@/shared/ui/ProviderMark";
import { Button, CountChips } from "@/shared/ui/ui";
import { cn, tildify } from "@/shared/utils";
import {
  useCodexNote,
  useCursorNote,
  useNow,
  useProjection,
  useProviderProblem,
  useRoute,
} from "@/state/hooks";

export function Home() {
  useLocale();
  const state = useProjection((p) => p);
  const now = useNow();
  const navigate = useNavigate();
  const summaries = useMemo(() => projectSummaries(state, now), [state, now]);
  const appearances = useProjectAppearances();
  const problem = useProviderProblem();
  const codexNote = useCodexNote();
  const cursorNote = useCursorNote();
  const empty = summaries.length === 0;
  const route = useRoute();
  const asksNewSession = route.level === "home" && route.newSession === true;
  const [creating, setCreating] = useState<"session" | "squad" | undefined>(
    asksNewSession ? "session" : undefined,
  );
  // The sidebar's "+" lands here with the panel open, even when Home is already showing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new route object is the signal.
  useEffect(() => {
    if (asksNewSession) setCreating("session");
  }, [route, asksNewSession]);
  const toggle = (kind: "session" | "squad") => setCreating((v) => (v === kind ? undefined : kind));
  const recent = useMemo(
    () =>
      [...summaries]
        .sort((a, b) => b.lastEventTs.localeCompare(a.lastEventTs))
        .slice(0, 5)
        .map(({ project }) => ({ name: project.name, root: project.root })),
    [summaries],
  );
  const waiting = needsYou(state, now);
  const decisions = squadNeedsYou(state);
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
          {all.running + all.waiting + decisions.length === 0 && (
            <p className="mt-1.5 text-ink-2">{t("home.allQuiet")}</p>
          )}
          <PlanUsage providers={AGENT_PROVIDERS} className="mt-2" />
          {/* Someone who installed Codex hears it's too old on any Home; a missing Codex is
              only mentioned on an empty Home, so Claude-only users aren't nagged. */}
          {codexNote === "outdated" && !empty && <CodexNote note="outdated" className="mt-1.5" />}
          {cursorNote === "outdated" && !empty && (
            <CodexNote provider="cursor" note="outdated" className="mt-1.5" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CountChips counts={all} />
          <NewSquadButton
            open={creating === "squad"}
            onToggle={() => toggle("squad")}
            controls="home-new-squad"
          />
          <NewSessionButton
            open={creating === "session"}
            onToggle={() => toggle("session")}
            controls="home-new-session"
          />
        </div>
      </header>

      {creating === "session" && (
        <NewSessionPanel
          id="home-new-session"
          recent={recent}
          onClose={() => setCreating(undefined)}
        />
      )}
      {creating === "squad" && (
        <NewSquadPanel id="home-new-squad" onClose={() => setCreating(undefined)} />
      )}
      {problem && !creating && <ConnectProvider provider="claude" problem={problem} />}

      {waiting.length + decisions.length > 0 && (
        <section aria-labelledby="needs-you">
          <h2 id="needs-you" className="mb-3 flex items-center gap-2 text-md font-semibold">
            <Hand size={16} aria-hidden="true" className="text-ink-3" />
            {t("home.needsYou")}
          </h2>
          <ul className="flex flex-col gap-2">
            {decisions.map((item) => (
              <SquadDecisionRow
                key={`${item.squad.id}:${item.decision.kind}:${item.decision.kind === "task" ? item.decision.taskId : ""}`}
                item={item}
              />
            ))}
            {waiting.map(({ project, session, agent }) => {
              const persona = toPersona(agent, session, now);
              const question = firstQuestion(agent);
              const asks = question?.questions[0]?.question ?? permissionSummary(agent);
              const open = () =>
                navigate({
                  level: "session",
                  projectId: project.id,
                  sessionId: session.id,
                  agentId: agent.id,
                });
              return (
                <li
                  key={`${session.id}:${agent.id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-waiting/40 bg-waiting-bg py-3 pr-4 pl-4"
                >
                  <button
                    type="button"
                    onClick={open}
                    className="flex min-w-[280px] flex-1 items-center gap-3 text-left"
                  >
                    <Orb
                      color={agentColor(agent.agentType)}
                      persona={persona}
                      size={34}
                      seed={agent.id}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-2">
                        <span className="truncate">
                          {project.name} › {sessionTitle(session) ?? t("session.untitled")}
                        </span>
                        <ProviderMark provider={session.provider} />
                      </span>
                      <span className="block truncate font-medium text-ink">
                        {agentName(agent)} {t(persona.label.key, persona.label.params)}
                      </span>
                      {asks && (
                        <span
                          className={cn(
                            "block truncate text-xs text-waiting-ink",
                            question ? "font-medium" : "font-mono",
                          )}
                        >
                          {asks}
                        </span>
                      )}
                    </span>
                  </button>
                  {question ? (
                    <Button variant="primary" onClick={open}>
                      {t("question.answer")}
                    </Button>
                  ) : (
                    <PermissionActions session={session} agent={agent} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {running.length > 0 && (
        <section aria-labelledby="running-now">
          <h2 id="running-now" className="mb-3 flex items-center gap-2 text-md font-semibold">
            <Activity size={16} aria-hidden="true" className="text-ink-3" />
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
                      seed={agent.id}
                      size={30}
                      glyph={false}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        <span className="font-semibold">{agentName(agent)}</span>{" "}
                        {t(persona.label.key, persona.label.params)}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
                        <span className="truncate">
                          {project.name} › {sessionTitle(session) ?? t("session.untitled")}
                        </span>
                        <ProviderMark provider={session.provider} />
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
        <h2 id="projects" className="mb-3 flex items-center gap-2 text-md font-semibold">
          <FolderKanban size={16} aria-hidden="true" className="text-ink-3" />
          {t("home.projects")}
        </h2>
        {empty ? (
          <div className="rounded-xl border border-hairline px-5 py-4">
            <p className="max-w-[68ch] text-ink-2">{t("home.empty")}</p>
            {codexNote && <CodexNote note={codexNote} className="mt-2" />}
            {cursorNote && <CodexNote provider="cursor" note={cursorNote} className="mt-2" />}
          </div>
        ) : (
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
                  <span className="flex min-w-0 items-center gap-3">
                    <ProjectTile
                      name={project.name}
                      appearance={appearances[project.id]}
                      className="size-7 rounded-lg text-xs"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{project.name}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {tildify(project.root)}
                      </span>
                    </span>
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
                    {recent && (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-3">
                        <span className="truncate">
                          {sessionTitle(recent) ?? t("session.untitled")}
                        </span>
                        <ProviderMark provider={recent.provider} compact />
                      </span>
                    )}
                  </span>
                  <span className="text-right text-xs text-ink-3 tabular-nums">
                    {ago(lastEventTs, now)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
