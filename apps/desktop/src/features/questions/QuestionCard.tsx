import type { AgentNode, PendingQuestion, SessionState } from "@gravita/core";
import { Terminal } from "lucide-react";
import { useId } from "react";
import { t } from "@/shared/i18n/i18n";
import { AutoTextarea, fieldFrame } from "@/shared/ui/form";
import { Button } from "@/shared/ui/ui";
import { cn, isSendChord } from "@/shared/utils";
import { useQuestionAnswer } from "./useQuestionAnswer";

/**
 * An agent's question, answered in place: each question with its options (one choice
 * or several), an optional reply in the user's own words, and Send.
 */
export function QuestionCard({
  session,
  agent,
  pending,
  className,
}: {
  session: SessionState;
  agent: AgentNode;
  pending: PendingQuestion;
  className?: string;
}) {
  if (!session.controllable) {
    return (
      <p className={cn("flex items-center gap-1.5 text-xs text-waiting-ink", className)}>
        <Terminal size={13} aria-hidden="true" />
        {t("action.answerInTerminal")}
      </p>
    );
  }
  return (
    <QuestionForm
      key={pending.requestId}
      session={session}
      agent={agent}
      pending={pending}
      className={className}
    />
  );
}

function QuestionForm({
  session,
  agent,
  pending,
  className,
}: {
  session: SessionState;
  agent: AgentNode;
  pending: PendingQuestion;
  className?: string;
}) {
  const model = useQuestionAnswer(session, agent, pending);
  const id = useId();

  return (
    <form
      noValidate
      aria-label={pending.questions[0]?.question}
      onSubmit={(e) => {
        e.preventDefault();
        model.submit();
      }}
      className={cn("flex flex-col gap-3", className)}
    >
      {pending.questions.map((q, qi) => {
        const picked = model.selections[qi] ?? [];
        return (
          <fieldset key={q.question} className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-sm leading-snug text-ink">
              {q.header && (
                <span className="mb-0.5 block text-xs font-semibold text-waiting-ink">
                  {q.header}
                </span>
              )}
              <span className="font-medium">{q.question}</span>
            </legend>
            {q.options.map((o) => {
              const checked = picked.includes(o.label);
              return (
                <label
                  key={o.label}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2 transition-colors",
                    checked
                      ? "border-waiting/50 bg-ground"
                      : "border-transparent bg-ground/60 hover:bg-ground",
                  )}
                >
                  <input
                    type={q.multiSelect ? "checkbox" : "radio"}
                    name={`${id}-${qi}`}
                    value={o.label}
                    checked={checked}
                    onChange={() => model.pick(qi, o.label, q.multiSelect)}
                    className="mt-0.5 size-3.5 flex-none accent-[var(--ink)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{o.label}</span>
                    {o.description && (
                      <span className="block text-xs leading-snug text-ink-2">{o.description}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
        );
      })}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-reply`} className="text-xs font-medium text-ink-2">
          {t("question.reply")}
        </label>
        <div className={cn(fieldFrame, "px-2.5 py-1.5")}>
          <AutoTextarea
            id={`${id}-reply`}
            value={model.response}
            onChange={(e) => model.setResponse(e.target.value)}
            onKeyDown={(e) => {
              if (isSendChord(e)) {
                e.preventDefault();
                model.submit();
              }
            }}
            placeholder={t("question.replyPlaceholder")}
            maxRows={5}
            className="text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Button type="submit" variant="primary" aria-busy={model.busy}>
          {model.busy ? t("question.sending") : t("question.send")}
        </Button>
        {model.incomplete && (
          <span role="alert" className="text-xs text-error-ink">
            {t("question.needAnswer")}
          </span>
        )}
        {model.error && (
          <span role="alert" className="text-xs text-error-ink">
            {model.error}
          </span>
        )}
      </div>
    </form>
  );
}
