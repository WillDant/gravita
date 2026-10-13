import { sessionCounts } from "@gravita/core";
import { GitBranch } from "lucide-react";
import { MiniLines } from "@/components/MiniLines";
import { CountChips, StatusText } from "@/components/ui";
import { ago, compact, t, useLocale } from "@/lib/i18n";
import { projectSummaries, sessionStatus, sessionTitle, tokensOf } from "@/lib/selectors";
import { tildify } from "@/lib/utils";
import { useStore } from "@/store";

export function Project({ projectId }: { projectId: string }) {
  useLocale();
  const state = useStore((s) => s.state);
  useStore((s) => s.rev);
  const now = useStore((s) => s.now);
  const navigate = useStore((s) => s.navigate);
  const summary = projectSummaries(state, now).find((p) => p.project.id === projectId);

  if (!summary) {
    return <p className="p-8 text-ink-2">{t("project.empty")}</p>;
  }
  const { project, sessions, counts } = summary;
  const branch = sessions.find((s) => s.gitBranch)?.gitBranch;

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
        <CountChips counts={counts} />
      </header>

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
            {sessions.map((s) => {
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
