import { modelChoice, type SquadState } from "@gravita/core";
import { agentColor } from "@gravita/orbs";
import type { SquadModels } from "@gravita/protocol";
import { lazy, Suspense, useId, useState } from "react";
import { useNavigate } from "@/app/providers";
import { Orb } from "@/features/agents/Orb";
import { QuestionCard } from "@/features/questions/QuestionCard";
import { firstQuestion } from "@/features/questions/questions";
import { Composer } from "@/features/session/composer/Composer";
import { t } from "@/shared/i18n/i18n";
import { usd } from "@/shared/presenters/money";
import { planShareText } from "@/shared/presenters/planUsage";
import { AutoTextarea, fieldFrame } from "@/shared/ui/form";
import { Button } from "@/shared/ui/ui";
import { cn, tildify } from "@/shared/utils";
import { useAppStore } from "@/state/hooks";
import type { SquadView } from "../model";
import { RESTING, sessionHead } from "../personas";
import { useSquadAction } from "../useSquadAction";

const ConversationLens = lazy(() => import("@/features/session/conversation/ConversationLens"));

/** The planner's tries before Gravita gives up on a plan (the engine's limit). */
export const PLANNER_TRIES = 3;

/**
 * The brief: a conversation with the read-only planner about what to build, until the
 * user asks for the plan. While the planner writes it, the same screen says so.
 */
export function Brief({
  squad: q,
  view,
  now,
}: {
  squad: SquadState;
  view: SquadView;
  now: number;
}) {
  const navigate = useNavigate();
  const session = view.planner?.session;
  const head = sessionHead(session, now);
  const planning = q.phase === "planning";
  const failed = q.phase === "failed";
  const replied = useAppStore(
    (s) =>
      s.conversation?.sessionId === session?.id &&
      Boolean(s.conversation?.messages.some((m) => m.role === "assistant")),
  );
  const plan = useSquadAction(useAppStore((s) => s.planSquad));
  const question = head && session ? firstQuestion(head.node) : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {planning && <PlanningBand squad={q} view={view} now={now} />}
        {failed && <PlannerFailed squad={q} />}
        <div className="min-h-0 flex-1">
          {session ? (
            <Suspense fallback={null}>
              <ConversationLens
                session={session}
                speaker={{ name: t("squad.role.planner"), agentType: "planner" }}
                empty={planning ? t("squad.brief.emptyPlanning") : t("squad.brief.empty")}
                onSelect={(agentId) =>
                  navigate({
                    level: "session",
                    projectId: q.projectId,
                    sessionId: session.id,
                    agentId,
                  })
                }
              />
            </Suspense>
          ) : (
            <p role="status" className="px-8 py-8 text-sm text-ink-2">
              {t("squad.brief.starting")}
            </p>
          )}
        </div>
        {q.phase === "brief" && session && (
          <>
            <div className="flex flex-none flex-wrap items-center gap-x-4 gap-y-2 border-t border-hairline bg-panel px-6 py-2.5">
              <p className="min-w-0 flex-1 text-sm text-ink-2">
                {replied ? t("squad.brief.readyHint") : t("squad.brief.waitHint")}
              </p>
              {plan.error && (
                <span role="alert" className="text-xs text-error-ink">
                  {plan.error}
                </span>
              )}
              <Button
                variant="primary"
                disabled={!replied}
                aria-busy={plan.busy}
                onClick={() => void plan.run(q.id)}
                className="disabled:cursor-default disabled:opacity-50 disabled:hover:bg-ink"
              >
                <PlannerMark />
                {t("squad.brief.generate")}
              </Button>
            </div>
            {session.controllable && (
              <Composer
                session={session}
                settings={false}
                placeholder={t("squad.brief.placeholder")}
              />
            )}
          </>
        )}
      </div>

      <aside className="flex w-[340px] flex-none flex-col overflow-y-auto border-l border-hairline max-[900px]:hidden">
        {question && session && head && (
          <div className="border-b border-waiting/30 bg-waiting-bg px-3 pt-3 pb-3">
            <p className="px-2 pb-1 text-sm font-semibold text-waiting-ink">
              {t("squad.brief.plannerAsks")}
            </p>
            <QuestionCard session={session} agent={head.node} pending={question} className="px-2" />
          </div>
        )}
        <section aria-labelledby="squad-brief" className="flex flex-col gap-4 px-5 pt-4 pb-6">
          <div className="flex items-center gap-3">
            <Orb
              color={agentColor("planner")}
              persona={head?.persona ?? RESTING}
              size={32}
              seed={`${q.id}:planner`}
            />
            <p className="min-w-0 text-sm leading-snug">
              <span className="font-semibold">{t("squad.role.planner")}</span>{" "}
              <span className="text-ink-2">{head ? head.label : t("squad.brief.notYet")}</span>
            </p>
          </div>
          <h2 id="squad-brief" className="text-sm font-semibold">
            {t("squad.brief.yours")}
          </h2>
          <p className="text-sm whitespace-pre-line text-ink">{q.brief}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-3">{t("newSession.folder")}</dt>
            <dd className="min-w-0 font-mono text-xs leading-5 break-all text-ink-2" title={q.cwd}>
              {tildify(q.cwd)}
            </dd>
            {q.baseBranch && (
              <>
                <dt className="text-ink-3">{t("squad.brief.branch")}</dt>
                <dd className="font-mono text-xs leading-5 text-ink-2">{q.baseBranch}</dd>
              </>
            )}
            <dt className="text-ink-3">{t("newSquad.budget")}</dt>
            <dd className="tabular text-ink-2">{planShareText(q) ?? usd(q.budgetUsd)}</dd>
            <dt className="text-ink-3">{t("squad.brief.autonomy")}</dt>
            <dd className="text-ink-2">{t(`newSquad.autonomy.${q.autonomy}`)}</dd>
            <dt className="text-ink-3">{t("squad.brief.models")}</dt>
            <dd className="text-ink-2">{modelsLabel(q.models)}</dd>
          </dl>
          <p className="text-xs text-ink-3">{t("squad.brief.readOnly")}</p>
        </section>
      </aside>
    </div>
  );
}

/** The squad's model choice by name; an older squad's mix as "x plans, y builds". */
function modelsLabel(models: SquadModels): string {
  const choice = modelChoice(models);
  return choice
    ? t(`newSquad.models.${choice}`)
    : t("squad.brief.modelsValue", { planner: models.planner, roles: models.roles });
}

/** The planner's line arriving at its first station: the plan this button asks for. */
function PlannerMark() {
  const c = agentColor("planner");
  return (
    <svg width={18} height={12} viewBox="0 0 18 12" aria-hidden="true" className="flex-none">
      <path d="M1.5 6 H12" stroke={c.line} strokeWidth={3} strokeLinecap="round" />
      <circle cx={13} cy={6} r={3.6} fill={c.fill} stroke="currentColor" strokeWidth={1.6} />
    </svg>
  );
}

/** The planner is writing the plan: say so, and why an earlier try was sent back. */
function PlanningBand({
  squad: q,
  view,
  now,
}: {
  squad: SquadState;
  view: SquadView;
  now: number;
}) {
  const head = sessionHead(view.planner?.session, now);
  const errors = q.planErrors ?? [];
  return (
    <div
      role="status"
      className="flex flex-none items-start gap-4 border-b border-hairline bg-panel px-6 py-4"
    >
      <Orb
        color={agentColor("planner")}
        persona={head?.persona ?? RESTING}
        size={40}
        seed={`${q.id}:planner`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-md font-semibold">{t("squad.planning.title")}</p>
        <p className="mt-0.5 max-w-[72ch] text-sm text-ink-2">
          {q.planStatus === "none" ? t("squad.planning.body") : t("squad.planning.again")}
        </p>
        {errors.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-ink">
              {t("squad.planning.rejected", {
                n: Math.min(q.planAttempts + 1, PLANNER_TRIES),
                total: PLANNER_TRIES,
              })}
            </p>
            <ul className="mt-1 flex flex-col gap-1 text-xs text-ink-2">
              {errors.map((e) => (
                <li key={e} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-1.5 flex-none rounded-full bg-error"
                  />
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** The planner couldn't produce a plan that passes: say why, and ask again with feedback. */
function PlannerFailed({ squad: q }: { squad: SquadState }) {
  const replan = useSquadAction(useAppStore((s) => s.replanSquad));
  const [feedback, setFeedback] = useState("");
  const id = useId();
  return (
    <div role="alert" className="flex-none border-b border-error/30 bg-error-bg px-6 py-4">
      <p className="text-md font-semibold text-error-ink">{t("squad.decision.plannerFailed")}</p>
      {q.phaseReason && <p className="mt-0.5 text-sm text-error-ink">{q.phaseReason}</p>}
      {(q.planErrors ?? []).length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-2">
          {(q.planErrors ?? []).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (feedback.trim()) void replan.run(q.id, feedback.trim());
        }}
        className="mt-3 flex flex-col gap-2"
      >
        <label htmlFor={`${id}-fb`} className="text-xs font-semibold text-ink-2">
          {t("squad.replan.label")}
        </label>
        <div className={cn(fieldFrame, "px-3 py-2")}>
          <AutoTextarea
            id={`${id}-fb`}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t("squad.replan.placeholder")}
            maxRows={6}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="submit"
            variant="primary"
            aria-busy={replan.busy}
            disabled={!feedback.trim()}
          >
            {t("squad.replan.send")}
          </Button>
          {replan.error && (
            <span role="alert" className="text-xs text-error-ink">
              {replan.error}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
