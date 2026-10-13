import { estimatePlanCost, type SquadState, validatePlan } from "@gravita/core";
import type { SquadPlan } from "@gravita/protocol";
import { RotateCcw } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { t } from "@/shared/i18n/i18n";
import { usd } from "@/shared/presenters/money";
import { AutoTextarea, fieldFrame } from "@/shared/ui/form";
import { Button } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { useAppStore } from "@/state/hooks";
import { taskOrder, titleOf } from "../model";
import { useSquadAction } from "../useSquadAction";
import { answersFor, editTask, moveTask, pinIssues, removeTask } from "./planDraft";
import { RoleStrip, type TaskEdits } from "./RoleStrip";

/**
 * The Board: the proposed plan to review. The planner's questions, its assumptions and
 * the exact checks on top, with the estimate next to Approve; below, each role as a
 * strip map of its tasks. Light edits re-validate live; Approve waits for a clean plan.
 */
export function Board({ squad: q, plan: proposed }: { squad: SquadState; plan: SquadPlan }) {
  const [draft, setDraft] = useState(proposed);
  const [base, setBase] = useState(proposed);
  // A new proposal (a replan landed) replaces the draft.
  if (base !== proposed) {
    setBase(proposed);
    setDraft(proposed);
  }
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Map<string, string[]>>(new Map());
  const issues = useMemo(() => validatePlan(draft), [draft]);
  const pinned = useMemo(() => pinIssues(draft, issues), [draft, issues]);
  const estimate = useMemo(() => estimatePlanCost(draft, q.models), [draft, q.models]);
  const approve = useSquadAction(useAppStore((s) => s.approvePlan));
  const edited = draft !== proposed;
  const order = useMemo(() => taskOrder(draft), [draft]);

  const note = (taskId: string, text: string) =>
    setNotes((m) => new Map(m).set(taskId, [...(m.get(taskId) ?? []), text]));

  const edits: TaskEdits = {
    edit: (taskId, patch) => setDraft((p) => editTask(p, taskId, patch)),
    remove: (taskId) => {
      const title = titleOf(draft, taskId);
      const r = removeTask(draft, taskId);
      setDraft(r.plan);
      for (const id of r.unblocked) note(id, t("squad.board.noLongerWaits", { task: title }));
    },
    move: (taskId, roleId) => {
      const r = moveTask(draft, taskId, roleId);
      if (r.ok) setDraft(r.plan);
    },
  };

  const roles = draft.roles.filter((r) => r.kind !== "planner");
  const tasksOf = (roleId: string) =>
    order.flatMap((id) => {
      const task = draft.tasks.find((x) => x.id === id);
      return task && task.role === roleId ? [task] : [];
    });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-6 px-6 pt-5 pb-10">
        <section
          aria-labelledby="plan-goal"
          className="flex flex-wrap items-start gap-x-10 gap-y-5"
        >
          <div className="min-w-[320px] flex-1">
            <h2 id="plan-goal" className="text-xl leading-tight font-bold tracking-[-0.01em]">
              {draft.goal}
            </h2>
            <p className="mt-2 max-w-[78ch] text-base text-ink-2">{draft.summary}</p>
            {draft.stack.length > 0 && (
              <ul aria-label={t("squad.board.stack")} className="mt-3 flex flex-wrap gap-1.5">
                {draft.stack.map((s) => (
                  <li
                    key={s}
                    className="rounded-full bg-panel px-2.5 py-0.5 text-xs font-medium text-ink-2"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ApproveBox
            squad={q}
            estimateUsd={estimate.totalUsd}
            issues={issues.length}
            edited={edited}
            busy={approve.busy}
            error={approve.error}
            onReset={() => {
              setDraft(proposed);
              setNotes(new Map());
            }}
            onApprove={() =>
              void approve.run({
                squadId: q.id,
                plan: draft,
                answers: answersFor(draft.questions, answers),
              })
            }
          />
        </section>

        {pinned.general.length > 0 && (
          <ul
            role="alert"
            className="flex flex-col gap-1 rounded-xl border border-error/30 bg-error-bg px-4 py-3 text-sm text-error-ink"
          >
            {pinned.general.map((i) => (
              <li key={i.message}>{i.message}</li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
          {draft.questions.length > 0 && (
            <Questions questions={draft.questions} answers={answers} onAnswer={setAnswers} />
          )}
          <section
            aria-labelledby="plan-assumptions"
            className="rounded-xl border border-hairline px-4 py-3"
          >
            <h3 id="plan-assumptions" className="text-sm font-semibold">
              {t("squad.board.assumptions")}
            </h3>
            {draft.assumptions.length === 0 ? (
              <p className="mt-1 text-sm text-ink-3">{t("squad.board.noAssumptions")}</p>
            ) : (
              <ul className="mt-1.5 flex flex-col gap-1 text-sm text-ink-2">
                {draft.assumptions.map((a) => (
                  <li key={a} className="flex gap-2">
                    <span
                      aria-hidden="true"
                      className="mt-[7px] size-1.5 flex-none rounded-full bg-ink-3"
                    />
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section
            aria-labelledby="plan-checks"
            className="rounded-xl border border-hairline px-4 py-3"
          >
            <h3 id="plan-checks" className="text-sm font-semibold">
              {t("squad.board.checks")}
            </h3>
            <p className="text-xs text-ink-3">{t("squad.board.checksHint")}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {draft.checks.map((c) => (
                <li key={c.id}>
                  <p className="flex items-baseline gap-2 text-xs">
                    <span className="font-medium text-ink-2">
                      {t(`squad.check.when.${c.when}`)}
                    </span>
                    {c.description && <span className="truncate text-ink-3">{c.description}</span>}
                  </p>
                  <code className="mt-0.5 block rounded-md bg-panel px-2 py-1 font-mono text-xs break-all text-ink">
                    {c.cwd !== "." && <span className="text-ink-3">{c.cwd}$ </span>}
                    {c.argv.join(" ")}
                  </code>
                  {(pinned.checks.get(c.id) ?? []).map((i) => (
                    <p key={i.message} className="mt-1 text-xs font-medium text-error-ink">
                      {i.message}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section aria-labelledby="plan-roles">
          <h2 id="plan-roles" className="mb-3 flex items-baseline gap-3 text-md font-semibold">
            {t("squad.board.team")}
            <span className="text-sm font-normal text-ink-3">
              {t("squad.board.teamHint", { roles: roles.length, tasks: draft.tasks.length })}
            </span>
          </h2>
          <div className="-mx-6 overflow-x-auto px-6 pb-2">
            <div className="flex w-max items-start gap-4">
              {roles.map((r) => (
                <RoleStrip
                  key={r.id}
                  plan={draft}
                  role={r}
                  tasks={tasksOf(r.id)}
                  {...(estimate.byRole[r.id] !== undefined
                    ? { estimateUsd: estimate.byRole[r.id] }
                    : {})}
                  issues={pinned.roles.get(r.id) ?? []}
                  taskIssues={pinned.tasks}
                  notes={notes}
                  edits={edits}
                />
              ))}
            </div>
          </div>
        </section>

        <Replan squad={q} />
      </div>
    </div>
  );
}

function ApproveBox({
  squad: q,
  estimateUsd,
  issues,
  edited,
  busy,
  error,
  onReset,
  onApprove,
}: {
  squad: SquadState;
  estimateUsd: number;
  issues: number;
  edited: boolean;
  busy: boolean;
  error?: string | undefined;
  onReset: () => void;
  onApprove: () => void;
}) {
  const over = estimateUsd > q.budgetUsd;
  return (
    <div className="flex w-[320px] flex-none flex-col gap-3 rounded-xl border border-hairline px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-2">{t("squad.board.estimate")}</span>
        <span className="tabular text-xl font-medium text-ink">≈ {usd(estimateUsd)}</span>
      </div>
      <p className="-mt-2 text-xs text-ink-3">
        {over
          ? t("squad.board.overBudget", { budget: usd(q.budgetUsd) })
          : t("squad.board.estimateHint", { budget: usd(q.budgetUsd) })}
      </p>
      <Button
        variant="primary"
        disabled={issues > 0}
        aria-busy={busy}
        aria-describedby="approve-why"
        onClick={onApprove}
        className="h-9 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-ink"
      >
        {busy ? t("squad.board.approving") : t("squad.board.approve")}
      </Button>
      <p id="approve-why" className={cn("text-xs", issues > 0 ? "text-error-ink" : "text-ink-3")}>
        {issues > 0 ? t("squad.board.fixFirst", { count: issues }) : t("squad.board.approveHint")}
      </p>
      {edited && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-ink-2 hover:text-ink"
        >
          <RotateCcw size={12} aria-hidden="true" />
          {t("squad.board.reset")}
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-error-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/** The planner's open questions, answered inline; the answers go with the approval. */
function Questions({
  questions,
  answers,
  onAnswer,
}: {
  questions: string[];
  answers: Record<string, string>;
  onAnswer: (next: Record<string, string>) => void;
}) {
  const id = useId();
  const open = questions.filter((q) => !answers[q]?.trim()).length;
  return (
    <section
      aria-labelledby={`${id}-q`}
      className={cn(
        "rounded-xl border px-4 py-3",
        open > 0 ? "border-waiting/40 bg-waiting-bg" : "border-hairline",
      )}
    >
      <h3 id={`${id}-q`} className={cn("text-sm font-semibold", open > 0 && "text-waiting-ink")}>
        {t("squad.board.questions", { count: questions.length })}
      </h3>
      <p className="text-xs text-ink-2">{t("squad.board.questionsHint")}</p>
      <ol className="mt-2 flex flex-col gap-3">
        {questions.map((q, i) => (
          <li key={q} className="flex flex-col gap-1">
            <label htmlFor={`${id}-${i}`} className="text-sm font-medium text-ink">
              {q}
            </label>
            <div className={cn(fieldFrame, "px-2.5 py-1.5")}>
              <AutoTextarea
                id={`${id}-${i}`}
                value={answers[q] ?? ""}
                onChange={(e) => onAnswer({ ...answers, [q]: e.target.value })}
                placeholder={t("squad.board.answerPlaceholder")}
                maxRows={5}
                className="text-sm"
              />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Ask for a new plan, in the user's words. */
function Replan({ squad: q }: { squad: SquadState }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const replan = useSquadAction(useAppStore((s) => s.replanSquad));
  const id = useId();
  if (!open) {
    return (
      <div className="flex items-center gap-3 border-t border-hairline pt-5">
        <Button onClick={() => setOpen(true)}>{t("squad.replan.open")}</Button>
        <span className="text-sm text-ink-3">{t("squad.replan.hint")}</span>
      </div>
    );
  }
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (feedback.trim()) void replan.run(q.id, feedback.trim());
      }}
      className="reveal flex max-w-[760px] flex-col gap-2 border-t border-hairline pt-5"
    >
      <label htmlFor={`${id}-fb`} className="text-sm font-semibold">
        {t("squad.replan.label")}
      </label>
      <div className={cn(fieldFrame, "px-3 py-2")}>
        <AutoTextarea
          id={`${id}-fb`}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={t("squad.replan.placeholder")}
          maxRows={8}
          className="min-h-[60px]"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          aria-busy={replan.busy}
          disabled={!feedback.trim()}
          className="disabled:opacity-50"
        >
          {t("squad.replan.send")}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t("newSession.cancel")}
        </Button>
        {replan.error && (
          <span role="alert" className="text-xs text-error-ink">
            {replan.error}
          </span>
        )}
      </div>
    </form>
  );
}
