import type { SquadState } from "@gravita/core";
import type { DeliverMode } from "@gravita/protocol";
import { RpcErrors } from "@gravita/protocol/constants";
import { Check, Copy, GitBranch, GitMerge, GitPullRequest } from "lucide-react";
import { useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { usd } from "@/shared/presenters/money";
import { budgetFigure } from "@/shared/presenters/planUsage";
import { squadDone } from "@/shared/presenters/squad";
import { Button, LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useAppStore, useUsage } from "@/state/hooks";
import { type SquadView, titleOf } from "../model";
import { SquadMap } from "../run/squad-map/SquadMap";
import { useSquadAction } from "../useSquadAction";

const MODES: { mode: DeliverMode; icon: typeof GitMerge }[] = [
  { mode: "merge", icon: GitMerge },
  { mode: "pr", icon: GitPullRequest },
  { mode: "branch", icon: GitBranch },
];

/** The squad's branch every role merged into. */
export const integrationBranch = (squadId: string) => `gravita/${squadId}/integration`;

/**
 * The end of the line: the squad's map drawn whole (every role merged into the trunk),
 * a line of facts, the one deliberate choice of what happens to the branch, then the
 * final checks and the work by role.
 */
export function Deliver({
  squad: q,
  view,
  now,
  onSelectTask,
  onSelectRole,
}: {
  squad: SquadState;
  view: SquadView;
  now: number;
  onSelectTask: (taskId: string) => void;
  onSelectRole: (roleId: string) => void;
}) {
  const { done, total } = squadDone(q);
  const usage = useUsage();
  const plan = view.plan;
  const finals = (plan?.checks ?? []).filter((c) => c.when === "final" || c.when === "integration");
  const branch = integrationBranch(q.id);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-8 pt-5 pb-14">
        <section aria-labelledby="deliver-title" className="flex flex-col gap-2 px-8">
          <h2 id="deliver-title" className="text-2xl font-bold tracking-[-0.02em]">
            {q.delivered ? t("squad.deliver.doneTitle") : t("squad.deliver.title")}
          </h2>
          {plan && <p className="max-w-[78ch] text-base text-ink-2">{plan.summary}</p>}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink-2">
            <span className="tabular-nums">{t("squad.progress", { done, total })}</span>
            <span aria-hidden="true" className="text-ink-3">
              ·
            </span>
            <span>{t("squad.roles", { count: view.roles.length })}</span>
            <span aria-hidden="true" className="text-ink-3">
              ·
            </span>
            <span className="tabular font-medium">{budgetFigure(q, usage).label}</span>
            <span aria-hidden="true" className="text-ink-3">
              ·
            </span>
            <code className="font-mono text-xs font-normal text-ink">{branch}</code>
          </p>
        </section>

        <div className="h-[360px] flex-none border-y border-hairline">
          <SquadMap
            squad={q}
            view={view}
            now={now}
            onSelectTask={onSelectTask}
            onSelectRole={onSelectRole}
          />
        </div>

        <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-8">
          {q.delivered ? <Delivered squad={q} /> : q.phase === "deliver" && <Choose squad={q} />}

          <section aria-labelledby="deliver-checks">
            <h3 id="deliver-checks" className="mb-2 text-md font-semibold">
              {t("squad.deliver.checks")}
            </h3>
            {finals.length === 0 ? (
              <p className="text-sm text-ink-3">{t("squad.deliver.noChecks")}</p>
            ) : (
              <ul className="overflow-hidden rounded-xl border border-hairline">
                {finals.map((c, i) => {
                  const run = q.checks[c.id];
                  return (
                    <li
                      key={c.id}
                      className={cn("px-4 py-2.5", i > 0 && "border-t border-hairline")}
                    >
                      <p className="flex items-center gap-3 text-sm">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "size-2 flex-none rounded-full",
                            !run ? "border border-ink-3" : run.ok ? "bg-ok" : "bg-error",
                          )}
                        />
                        <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                          {c.argv.join(" ")}
                        </code>
                        <span
                          className={cn(
                            "text-xs font-medium",
                            run && !run.ok ? "text-error-ink" : run ? "text-ok-ink" : "text-ink-3",
                          )}
                        >
                          {!run
                            ? t("squad.check.notRun")
                            : run.ok
                              ? t("squad.check.ok")
                              : t("squad.check.red")}
                        </span>
                        {run?.durationMs !== undefined && (
                          <span className="tabular w-14 text-right text-xs text-ink-3">
                            {(run.durationMs / 1000).toFixed(1)}s
                          </span>
                        )}
                      </p>
                      {run && !run.ok && run.outputPreview && (
                        <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-error-bg px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap text-error-ink">
                          {run.outputPreview}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="deliver-roles">
            <h3 id="deliver-roles" className="mb-2 text-md font-semibold">
              {t("squad.deliver.byRole")}
            </h3>
            <ul className="overflow-hidden rounded-xl border border-hairline">
              {view.roles.map((r, i) => {
                const commits = q.commits.filter((c) => c.role === r.id);
                const files = [...new Set(commits.flatMap((c) => c.files))].sort();
                return (
                  <li key={r.id} className={cn("px-4 py-3", i > 0 && "border-t border-hairline")}>
                    <p className="flex items-center gap-2">
                      <LineBadge agentType={r.colorKey} code={r.code} title={r.name} size={18} />
                      <span className="text-sm font-semibold">{r.name}</span>
                      <span className="text-xs text-ink-3">
                        {t("squad.deliver.commits", { count: commits.length })} ·{" "}
                        {t("squad.deliver.files", { count: files.length })}
                      </span>
                      <span className="tabular ml-auto text-xs text-ink-2">{usd(r.spentUsd)}</span>
                    </p>
                    <ul className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-x-6 gap-y-0.5 pl-[26px]">
                      {commits.map((c) => (
                        <li key={c.sha} className="flex items-baseline gap-2 text-xs">
                          <code className="font-mono text-ink-3">{c.sha.slice(0, 7)}</code>
                          <span className="min-w-0 flex-1 truncate text-ink-2">
                            {titleOf(plan, c.taskId)}
                          </span>
                          <span className="tabular-nums text-ink-3">{c.files.length}</span>
                        </li>
                      ))}
                    </ul>
                    {files.length > 0 && (
                      <details className="mt-1.5 pl-[26px] text-xs">
                        <summary className="cursor-pointer font-medium text-ink-2 hover:text-ink">
                          {t("squad.deliver.showFiles")}
                        </summary>
                        <ul className="mt-1 flex flex-col font-mono text-[11px] text-ink-2">
                          {files.map((f) => (
                            <li key={f} className="truncate">
                              {f}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Three ways to deliver, one sentence each, then a confirmation naming what happens. */
function Choose({ squad: q }: { squad: SquadState }) {
  const [mode, setMode] = useState<DeliverMode>();
  const deliver = useSquadAction(useAppStore((s) => s.deliverSquad));
  const [noGh, setNoGh] = useState(false);
  const base = q.baseBranch ?? t("squad.deliver.yourBranch");
  const branch = integrationBranch(q.id);
  const confirm = async () => {
    if (!mode) return;
    const ok = await deliver.run(q.id, mode);
    if (!ok && mode === "pr") setNoGh(true);
  };
  const ghMissing = noGh && deliver.code === RpcErrors.ghUnavailable.code;

  return (
    <section aria-labelledby="deliver-choose" className="flex flex-col gap-3">
      <h3 id="deliver-choose" className="text-md font-semibold">
        {t("squad.deliver.choose")}
      </h3>
      <div
        role="radiogroup"
        aria-labelledby="deliver-choose"
        className="grid grid-cols-3 gap-0.5 rounded-xl bg-panel p-0.5 max-[860px]:grid-cols-1"
      >
        {MODES.map(({ mode: m, icon: Icon }) => {
          const disabled = m === "pr" && ghMissing;
          const selected = mode === m;
          return (
            <label
              key={m}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-[10px] px-4 py-3 text-left transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
                selected ? "bg-ground shadow-panel" : "hover:bg-panel-2",
                disabled && "cursor-default opacity-60 hover:bg-transparent",
              )}
            >
              {/* Native radios: arrow keys move between the three, Tab leaves the group. */}
              <input
                type="radio"
                name="deliver-mode"
                value={m}
                checked={selected}
                disabled={disabled}
                onChange={() => {
                  setMode(m);
                  deliver.clear();
                }}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Icon size={15} aria-hidden="true" />
                {t(`squad.deliver.${m}`)}
              </span>
              <span className="text-xs text-ink-2">
                {disabled
                  ? t("squad.deliver.prNoGh")
                  : t(`squad.deliver.${m}.hint`, { base, branch })}
              </span>
            </label>
          );
        })}
      </div>
      {mode && (
        <div className="reveal flex flex-wrap items-center gap-3 rounded-xl border border-hairline px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-ink">
            {t(`squad.deliver.${mode}.confirm`, { base, branch })}
          </p>
          <Button variant="ghost" onClick={() => setMode(undefined)}>
            {t("newSession.cancel")}
          </Button>
          <Button variant="primary" aria-busy={deliver.busy} onClick={() => void confirm()}>
            {deliver.busy ? t("squad.deliver.working") : t(`squad.deliver.${mode}.go`)}
          </Button>
          {deliver.error && (
            <p role="alert" className="w-full text-xs text-error-ink">
              {deliver.error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** What happened to the work, with the branch or pull request to open next. */
function Delivered({ squad: q }: { squad: SquadState }) {
  const d = q.delivered;
  const [copied, setCopied] = useState(false);
  if (!d) return null;
  const url = /^https?:\/\//.test(d.ref);
  return (
    <section
      aria-labelledby="deliver-done"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-hairline px-4 py-3.5"
    >
      <span
        className="flex size-7 items-center justify-center rounded-full bg-ink text-ground"
        aria-hidden="true"
      >
        <Check size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <h3 id="deliver-done" className="text-sm font-semibold">
          {t(`squad.deliver.done.${d.mode}`)}
        </h3>
        {url ? (
          <a
            href={d.ref}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs break-all text-ink underline"
          >
            {d.ref}
          </a>
        ) : (
          <code className="font-mono text-xs break-all text-ink-2">{d.ref}</code>
        )}
      </div>
      <Button
        onClick={() => {
          void navigator.clipboard?.writeText(d.ref).then(
            () => setCopied(true),
            () => {},
          );
        }}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        {copied ? t("connect.copied") : t("squad.deliver.copy")}
      </Button>
    </section>
  );
}
