import type { SessionRuntimeRegistry } from "../ports/session-runtime";
import { requireRuntime } from "./require-runtime";

export interface QuestionAnswer {
  sessionId: string;
  agentId: string;
  requestId: string;
  answers: Record<string, string>;
  response?: string;
}

/** Answers an agent's pending question (AskUserQuestion) in a session Gravita runs. */
export class AnswerQuestion {
  constructor(private readonly runtimes: SessionRuntimeRegistry) {}

  async execute(p: QuestionAnswer): Promise<{ ok: true }> {
    await requireRuntime(this.runtimes, p.sessionId).answerQuestion(
      p.agentId,
      p.requestId,
      p.answers,
      p.response,
    );
    return { ok: true };
  }
}
