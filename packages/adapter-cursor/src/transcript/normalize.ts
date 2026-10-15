import { type GravitaEvent, keys } from "@gravita/protocol";
import { preview } from "@gravita/protocol/tools";
import { cursorCallId, cursorMessageId } from "../ids";
import {
  normalizedPrompt,
  type TranscriptRecord,
  userQueryOf,
  visibleText,
} from "./records";
import { type TaskCall, todoItems, transcriptTool } from "./tools";

// Transcript records as Gravita events. A transcript has no results, ids or timestamps of its
// own, so this makes them up in a way that stays the same however the file is read:
// - ids come from the record's place in the file (it only ever grows);
// - a tool call is completed (ok) when the next record shows the agent moved on, or failed
//   when the turn ends badly;
// - times come from the caller (the file's modification time).

export const MAIN_AGENT = "main";

/** A subagent task a transcript started, found again by its prompt in the subagent's file. */
export interface StartedTask {
  toolUseId: string;
  agentType: string;
  description: string;
  background: boolean;
}

/** Where one transcript has got to; plain JSON, so it survives a restart. */
export interface FileState {
  /** Records read so far: the id of the next one. */
  line: number;
  /** Tool calls not closed yet. */
  open: string[];
  /** A turn is under way: something was written since the last `turn_ended`. */
  turnOpen: boolean;
  /** The first message the user (or a parent agent) gave this transcript. */
  firstPrompt?: string;
  /** Tasks this transcript started, by their prompt. */
  tasks: Record<string, StartedTask>;
}

export const newFileState = (): FileState => ({ line: 0, open: [], turnOpen: false, tasks: {} });

export interface NormalizeContext {
  /** The Gravita session (the root chat's). */
  sessionId: string;
  projectId: string;
  /** The chat this transcript belongs to. */
  chatId: string;
  /** `main`, or the subagent's agent id. */
  agentId: string;
}

function envelope(c: NormalizeContext, ts: string) {
  return {
    ts,
    source: "cursor-transcript" as const,
    provider: "cursor" as const,
    projectId: c.projectId,
    sessionId: c.sessionId,
    agentId: c.agentId,
  };
}

function closeOpen(c: NormalizeContext, s: FileState, ts: string, failure?: string): GravitaEvent[] {
  const events = s.open.map(
    (toolUseId): GravitaEvent => ({
      ...envelope(c, ts),
      key: keys.toolCompleted(toolUseId),
      type: "tool.completed",
      data: failure ? { toolUseId, ok: false, error: failure } : { toolUseId, ok: true },
    }),
  );
  s.open = [];
  return events;
}

/** The events of one record; `s` moves on. */
export function normalizeRecord(
  c: NormalizeContext,
  s: FileState,
  r: TranscriptRecord,
  ts: string,
): GravitaEvent[] {
  const line = s.line++;
  const e = envelope(c, ts);
  // Whatever the agent was waiting for is over once it writes again.
  const events = closeOpen(c, s, ts, r.kind === "turn_ended" && r.status !== "success" ? r.status : undefined);

  if (r.kind === "user") {
    const text = userQueryOf(r.text);
    s.firstPrompt ??= normalizedPrompt(text);
    s.turnOpen = true;
    // A subagent's first message is its task: the parent's call already shows it.
    if (c.agentId === MAIN_AGENT) {
      const uuid = `cursor:${c.chatId}:L${line}`;
      events.push({
        ...e,
        key: keys.userMessage(uuid),
        type: "message.user",
        data: { uuid, textPreview: preview(text), origin: "human" },
      });
    }
    return events;
  }

  if (r.kind === "turn_ended") {
    s.turnOpen = false;
    if (c.agentId === MAIN_AGENT) {
      events.push({
        ...e,
        key: keys.turnCompleted(c.sessionId, `${c.chatId}:L${line}`),
        type: "turn.completed",
        data: { subtype: r.status },
      });
    } else {
      events.push({
        ...e,
        key: keys.agentCompleted(c.sessionId, c.agentId),
        type: "agent.completed",
        data: { status: r.status === "success" ? "completed" : "failed" },
      });
    }
    return events;
  }

  s.turnOpen = true;
  r.blocks.forEach((b, i) => {
    if (b.type === "text") {
      const messageId = cursorMessageId(c.chatId, `L${line}`, i);
      const text = visibleText(b.text);
      events.push(
        text
          ? {
              ...e,
              key: keys.assistantBlock(messageId, "text", "0"),
              type: "message.assistant",
              data: { messageId, textPreview: preview(text) },
            }
          : {
              ...e,
              key: keys.assistantBlock(messageId, "thinking", "0"),
              type: "thinking",
              data: { messageId },
            },
      );
      return;
    }
    const tool = transcriptTool(b.name, b.input);
    if (!tool) return;
    const toolUseId = cursorCallId(c.chatId, `L${line}.${i}`);
    events.push({
      ...e,
      key: keys.toolStarted(toolUseId),
      type: "tool.started",
      data: {
        toolUseId,
        name: tool.name,
        kind: tool.kind,
        target: tool.target,
        inputPreview: tool.inputPreview,
      },
    });
    if (tool.kind === "todo") {
      events.push({
        ...e,
        key: `todo:${toolUseId}`,
        type: "todo.updated",
        data: { items: todoItems(b.input) },
      });
    }
    if (tool.task) s.tasks[normalizedPrompt(tool.task.prompt)] = startedTask(toolUseId, tool.task);
    s.open.push(toolUseId);
  });
  return events;
}

function startedTask(toolUseId: string, t: TaskCall): StartedTask {
  return {
    toolUseId,
    agentType: t.subagentType,
    description: t.description,
    background: t.background,
  };
}
