import {
  type GravitaEvent,
  keys,
  MAIN_AGENT,
  type Provider,
  type Question,
} from "@gravita/protocol";
import { InvalidAnswerError, NotControllableError } from "../../domain/errors";
import type { Clock } from "../ports/clock";
import type { PermissionDecision } from "../ports/session-runtime";
import type { IngestEvents } from "../usecases/ingest-events";

// Holds the agent's pending "may I?" requests of one session until the user answers in
// Gravita. A tool permission becomes `permission.requested`; AskUserQuestion becomes
// `question.asked`. Nothing is answered automatically: a request only ends without the
// user when the agent cancels it or the session closes (`by: "timeout"`).

/** What the agent is told; the same shape as the Agent SDK's PermissionResult. */
export type ToolDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string; interrupt?: boolean };

export interface ToolPermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  /** The SDK's request id; unique per request, used as the event's request id. */
  requestId: string;
  toolUseId?: string;
  /** The subagent asking; absent for the main agent. */
  agentId?: string;
  /** Aborted when the agent no longer needs the answer (interrupt, turn end). */
  signal?: AbortSignal;
}

export interface BrokerSession {
  sessionId: string;
  projectId: string;
  provider: Provider;
}

export interface PermissionBrokerOptions {
  session: BrokerSession;
  ingest: IngestEvents;
  clock: Clock;
  /** One-line summary of a tool input, for the permission card. */
  describeInput: (input: Record<string, unknown>) => string;
}

export const ASK_USER_QUESTION = "AskUserQuestion";
const DENIED = "The user denied this in Gravita.";
const CANCELLED = "The request was cancelled before the user answered.";
const CLOSED = "The session was closed before the user answered.";

interface Pending {
  agentId: string;
  kind: "permission" | "question";
  input: Record<string, unknown>;
  questions: Question[];
  resolve: (d: ToolDecision) => void;
  cleanup: () => void;
}

/** Reads AskUserQuestion's `questions` through an allowlist. */
export function parseQuestions(input: Record<string, unknown>): Question[] {
  if (!Array.isArray(input.questions)) return [];
  const out: Question[] = [];
  for (const raw of input.questions as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const q = raw as Record<string, unknown>;
    if (typeof q.question !== "string" || !q.question.trim()) continue;
    const options = Array.isArray(q.options)
      ? (q.options as unknown[]).flatMap((o) => {
          if (!o || typeof o !== "object") return [];
          const { label, description } = o as Record<string, unknown>;
          if (typeof label !== "string" || !label) return [];
          return [{ label, ...(typeof description === "string" ? { description } : {}) }];
        })
      : [];
    out.push({
      question: q.question,
      ...(typeof q.header === "string" ? { header: q.header } : {}),
      multiSelect: q.multiSelect === true,
      options,
    });
  }
  return out;
}

export class PermissionBroker {
  private readonly pending = new Map<string, Pending>();
  private closed = false;

  constructor(private readonly o: PermissionBrokerOptions) {}

  /** Number of requests waiting on the user. */
  get size(): number {
    return this.pending.size;
  }

  /** Asks the user; resolves with their decision (or a deny if cancelled or closed). */
  request(r: ToolPermissionRequest): Promise<ToolDecision> {
    if (this.closed) return Promise.resolve({ behavior: "deny", message: CLOSED });
    if (r.signal?.aborted) return Promise.resolve({ behavior: "deny", message: CANCELLED });
    if (this.pending.has(r.requestId)) {
      return Promise.resolve({ behavior: "deny", message: CANCELLED });
    }
    const agentId = r.agentId || MAIN_AGENT;
    const questions = r.toolName === ASK_USER_QUESTION ? parseQuestions(r.input) : [];
    // A malformed question falls back to an ordinary permission prompt.
    const kind = questions.length ? "question" : "permission";
    return new Promise<ToolDecision>((resolve) => {
      const onAbort = () =>
        this.settle(r.requestId, { behavior: "deny", message: CANCELLED }, "timeout");
      r.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(r.requestId, {
        agentId,
        kind,
        input: r.input,
        questions,
        resolve,
        cleanup: () => r.signal?.removeEventListener("abort", onAbort),
      });
      const base = this.base(agentId);
      const toolUse = r.toolUseId ? { toolUseId: r.toolUseId } : {};
      this.o.ingest.execute([
        kind === "question"
          ? {
              ...base,
              key: keys.questionAsked(r.requestId),
              type: "question.asked",
              data: { requestId: r.requestId, ...toolUse, questions },
            }
          : {
              ...base,
              key: keys.permissionRequested(r.requestId),
              type: "permission.requested",
              data: {
                requestId: r.requestId,
                ...toolUse,
                toolName: r.toolName,
                inputPreview: this.o.describeInput(r.input),
              },
            },
      ]);
    });
  }

  /** The user allowed or denied a tool. */
  respond(agentId: string, requestId: string, decision: PermissionDecision) {
    const p = this.pending.get(requestId);
    if (p?.kind !== "permission" || p.agentId !== agentId) {
      throw new NotControllableError(this.o.session.sessionId);
    }
    this.settle(
      requestId,
      decision === "allow"
        ? { behavior: "allow", updatedInput: p.input }
        : { behavior: "deny", message: DENIED },
      "user",
    );
  }

  /** The user answered a question: chosen labels per question text, and/or free text. */
  answer(agentId: string, requestId: string, answers: Record<string, string>, response?: string) {
    const p = this.pending.get(requestId);
    if (p?.kind !== "question" || p.agentId !== agentId) {
      throw new NotControllableError(this.o.session.sessionId);
    }
    const asked = new Set(p.questions.map((q) => q.question));
    const picked = Object.fromEntries(
      Object.entries(answers).filter(([q, a]) => asked.has(q) && a.trim()),
    );
    const text = response?.trim();
    if (!Object.keys(picked).length && !text) throw new InvalidAnswerError(requestId);
    this.settle(
      requestId,
      {
        behavior: "allow",
        updatedInput: { ...p.input, answers: picked, ...(text ? { response: text } : {}) },
      },
      "user",
    );
  }

  /** Denies everything still pending (the session is closing) and refuses new requests. */
  dispose() {
    this.closed = true;
    for (const id of [...this.pending.keys()]) {
      this.settle(id, { behavior: "deny", message: CLOSED }, "timeout");
    }
  }

  private settle(requestId: string, decision: ToolDecision, by: "user" | "timeout") {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    p.cleanup();
    const base = this.base(p.agentId);
    const resolved: GravitaEvent =
      p.kind === "question"
        ? {
            ...base,
            key: keys.questionAnswered(requestId),
            type: "question.answered",
            data: { requestId, by },
          }
        : {
            ...base,
            key: keys.permissionResolved(requestId),
            type: "permission.resolved",
            data: { requestId, decision: decision.behavior, by },
          };
    this.o.ingest.execute([resolved]);
    p.resolve(decision);
  }

  private base(agentId: string) {
    const s = this.o.session;
    return {
      ts: this.o.clock.iso(),
      source: "gravita" as const,
      provider: s.provider,
      projectId: s.projectId,
      sessionId: s.sessionId,
      agentId,
    };
  }
}
