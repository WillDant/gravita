import { sessionCounts } from "@gravita/core";
import { GitBranch } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "@/app/providers";
import { MiniLines } from "@/features/agents/MiniLines";
import { NewSessionButton, NewSessionPanel } from "@/features/new-session/NewSessionPanel";
import { NewSquadButton, NewSquadPanel } from "@/features/new-squad/NewSquadPanel";
import { SquadRow } from "@/features/squad-row/SquadRow";
import { ago, compact, t, useLocale } from "@/shared/i18n/i18n";
import {
  projectSummaries,
  sessionStatus,
  sessionTitle,
  tokensOf,
} from "@/shared/presenters/selectors";
import { projectItems } from "@/shared/presenters/squad";
import { CountChips, StatusText } from "@/shared/ui/ui";
import { tildify } from "@/shared/utils";
import { useNow, useProjection } from "@/state/hooks";

export function Project({ projectId }: { projectId: string }) {
  useLocale();
  const state = useProjection((p) => p);
  const now = useNow();
  const navigate = useNavigate();
  const summary = projectSummaries(state, now).find((p) => p.project.id === projectId);
  const [creating, setCreating] = useState<"session" | "squad">();

  if (!summary) {
    return <p className="p-8 text-ink-2">{t("project.empty")}</p>;
  }
  const { project, sessions, counts } = summary;
  const branch = sessions.find((s) => s.gitBranch && !s.squadId)?.gitBranch;
  const items = projectItems(state, project);
  const toggle = (kind: "session" | "squad") => setCreating((v) => (v === kind ? undefined : kind));

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-8 pt-8 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-[-0.02em]">{project.name}</h1>
          <p className="mt-1 flex items-center gap-3 text-sm text-ink-2">
            <span className="truncate">{tildify(project.root)}</span>
            {branch && (
              <span className="inline-flex items-center gap-1 text-ink-3">
                <GitBranch size={13} aria-hidden="true" />
                {branch}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CountChips counts={counts} />
          <NewSquadButton
            open={creating === "squad"}
            onToggle={() => toggle("squad")}
            controls="project-new-squad"
          />
          <NewSessionButton
            open={creating === "session"}
            onToggle={() => toggle("session")}
            controls="project-new-session"
          />
        </div>
      </header>

      {creating === "session" && (
        <NewSessionPanel
          id="project-new-session"
          defaultFolder={project.root}
          onClose={() => setCreating(undefined)}
        />
      )}
      {creating === "squad" && (
        <NewSquadPanel
          id="project-new-squad"
          defaultFolder={project.root}
          onClose={() => setCreating(undefined)}
        />
      )}

      <section aria-labelledby="sessions">
        <h2 id="sessions" className="sr-only">
          {t("project.sessions")}
        </h2>
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th className="w-[44%] border-b border-hairline pb-2 pl-3 font-medium">
                {t("project.col.session")}
              </th>
              <th className="w-[20%] border-b border-hairline pb-2 font-medium">
                {t("project.col.lines")}
              </th>
              <th className="w-[16%] border-b border-hairline pb-2 font-medium">
                {t("project.col.status")}
              </th>
              <th className="w-[10%] border-b border-hairline pb-2 text-right font-medium">
                {t("project.col.tokens")}
              </th>
              <th className="w-[10%] border-b border-hairline pb-2 pr-3 text-right font-medium">
                {t("project.col.activity")}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              if (item.kind === "squad")
                return (
                  <SquadRow
                    key={item.squad.id}
                    squad={item.squad}
                    sessions={item.sessions}
                    lastEventTs={item.lastEventTs}
                    now={now}
                    onOpen={() => navigate({ level: "squad", projectId, squadId: item.squad.id })}
                  />
                );
              const s = item.session;
              const c = sessionCounts(s, now);
              return (
                <tr
                  key={s.id}
                  tabIndex={0}
                  onClick={() => navigate({ level: "session", projectId, sessionId: s.id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      navigate({ level: "session", projectId, sessionId: s.id });
                  }}
                  className="cursor-pointer transition-colors hover:bg-panel focus-visible:bg-panel"
                >
                  <td className="border-b border-hairline py-3 pl-3">
                    <span className="block truncate font-medium">
                      {sessionTitle(s) ?? t("session.untitled")}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-3">
                      {t(`kind.${s.kind}`)} · {t("count.subagents", { count: c.subagentsTotal })}
                    </span>
                  </td>
                  <td className="border-b border-hairline py-2">
                    <MiniLines session={s} now={now} />
                  </td>
                  <td className="border-b border-hairline py-3">
                    <StatusText status={sessionStatus(s, now)} />
                  </td>
                  <td className="border-b border-hairline py-3 text-right text-ink-2 tabular">
                    {compact(tokensOf(s))}
                  </td>
                  <td className="border-b border-hairline py-3 pr-3 text-right text-xs text-ink-3">
                    {ago(s.lastEventTs, now)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
