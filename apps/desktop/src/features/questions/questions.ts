import type { AgentNode, PendingQuestion } from "@gravita/core";
import type { Question } from "@gravita/protocol";

/** The oldest question an agent is waiting on the user to answer, if any. */
export function firstQuestion(agent: AgentNode): PendingQuestion | undefined {
  return Object.values(agent.questions ?? {}).sort((a, b) => a.ts.localeCompare(b.ts))[0];
}

/** Chosen labels per question, by the question's index. */
export type Selections = Record<number, string[]>;

/**
 * The `question.answer` payload: question text → chosen label (several joined with ", "),
 * plus the free-text reply when there is one.
 */
export function buildAnswer(
  questions: readonly Question[],
  selections: Selections,
  response: string,
): { answers: Record<string, string>; response?: string } {
  const answers: Record<string, string> = {};
  questions.forEach((q, i) => {
    const picked = selections[i] ?? [];
    if (picked.length > 0) answers[q.question] = picked.join(", ");
  });
  const reply = response.trim();
  return reply ? { answers, response: reply } : { answers };
}

/** Picks a label: replaces the choice for single-select, toggles it for multi-select. */
export function toggleSelection(
  selections: Selections,
  index: number,
  label: string,
  multi: boolean,
): Selections {
  const cur = selections[index] ?? [];
  const next = multi
    ? cur.includes(label)
      ? cur.filter((l) => l !== label)
      : [...cur, label]
    : [label];
  return { ...selections, [index]: next };
}
