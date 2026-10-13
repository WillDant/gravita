import type { AgentNode, PendingQuestion, SessionState } from "@gravita/core";
import { useState } from "react";
import { describeError } from "@/shared/presenters/errors";
import { useControl } from "@/state/hooks";
import { buildAnswer, type Selections, toggleSelection } from "./questions";

export interface QuestionAnswerModel {
  selections: Selections;
  response: string;
  pick: (index: number, label: string, multi: boolean) => void;
  setResponse: (text: string) => void;
  busy: boolean;
  /** Why the last attempt didn't go through: nothing chosen, or the engine's error. */
  error?: string;
  incomplete: boolean;
  submit: () => void;
}

/** Choices and free text for one pending question, sent with `question.answer`. */
export function useQuestionAnswer(
  session: SessionState,
  agent: AgentNode,
  pending: PendingQuestion,
): QuestionAnswerModel {
  const { answerQuestion } = useControl();
  const [selections, setSelections] = useState<Selections>({});
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [incomplete, setIncomplete] = useState(false);

  const submit = () => {
    if (busy) return;
    const payload = buildAnswer(pending.questions, selections, response);
    const answered = pending.questions.every((_, i) => (selections[i] ?? []).length > 0);
    if (!answered && !payload.response) {
      setIncomplete(true);
      return;
    }
    setIncomplete(false);
    setError(undefined);
    setBusy(true);
    void answerQuestion({
      sessionId: session.id,
      agentId: agent.id,
      requestId: pending.requestId,
      ...payload,
    }).then((r) => {
      setBusy(false);
      if (!r.ok) setError(describeError(r.error).text);
    });
  };

  return {
    selections,
    response,
    pick: (index, label, multi) => {
      setIncomplete(false);
      setSelections((s) => toggleSelection(s, index, label, multi));
    },
    setResponse: (text) => {
      setIncomplete(false);
      setResponse(text);
    },
    busy,
    error,
    incomplete,
    submit,
  };
}
