import { createHash } from "node:crypto";
import { isCursorMode, settingsModeOf } from "@gravita/core";
import { type GravitaEvent, keys, MAIN_AGENT } from "@gravita/protocol";
import { preview, type ToolTarget } from "@gravita/protocol/tools";
import { cursorCallId, cursorMessageId } from "../ids";
import {
  cursorInputPreview,
  cursorPaths,
  cursorToolKind,
  cursorToolName,
  cursorToolTarget,
} from "../tools";
import type { ContentBlock, SessionNotification, ToolCall } from "./types";

// Maps the live stream of `cursor-agent acp` to Gravita events. ACP streams a reply in
// chunks: consecutive chunks of one kind make one block (a message, a thought), which
// becomes one event when the block ends (another block, a tool call, the turn's end). Keys
// are deterministic: a block is named by the turn (the id Gravita gave its user message) and
// its place in it, a tool call by its ACP id, so mapping the same stream twice stores
// nothing twice.
//
// Every text that becomes an event goes through `redact` first (whole, before it is cut to
// a preview), so the Cursor API key never lands in Gravita's database (ADR 008).
//
// What the user typed is not mapped: Gravita stored it when it sent it.

export interface CursorAcpMapperOptions {
  projectId: string;
  /** "cursor:<ACP session id>". */
  sessionId: string;
  acpSessionId: string;
  /** The model the session runs (named on its messages). */
  model?: string;
  /** The session's mode in Cursor's terms, as Gravita last set it. */
  mode?: string;
  now: () => string;
  /** Masks secrets in a text before it becomes an event (default: unchanged). */
  redact?: (text: string) => string;
  /** An update Gravita doesn't read (for the log; it is otherwise skipped). */
  onUnknown?: (what: string) => void;
  /** Full assistant text for the Conversation lens (after redaction, before preview). */
  onAssistant?: (messageId: string, text: string) => void;
}

interface Block {
  kind: "text" | "thinking";
  messageId: string;
  text: string;
}

interface Call {
  call: ToolCall;
  started: boolean;
  done: boolean;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

const textOf = (c: ContentBlock | undefined): string =>
  c && c.type === "text" && typeof c.text === "string" ? c.text : "";

/** What a finished call printed or answered, in plain text. */
function outputOf(call: ToolCall): string {
  const parts: string[] = [];
  for (const c of call.content ?? []) if (c?.type === "content") parts.push(textOf(c.content));
  if (parts.some((p) => p)) return parts.join("\n");
  const raw = call.rawOutput;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    for (const k of ["stdout", "output", "content", "result", "error", "stderr"])
      if (typeof r[k] === "string" && r[k]) return r[k] as string;
  }
  return "";
}

/** Kinds whose successful call wrote files. */
const WRITES = new Set(["edit", "delete", "move"]);

export class CursorAcpMapper {
  private model: string | undefined;
  private mode: string | undefined;
  private readonly redact: (text: string) => string;
  private turnId: string | undefined;
  /** Turns of this mapper without a Gravita message (updates outside a prompt). */
  private loose = 0;
  private blocks = 0;
  private plans = 0;
  private block: Block | undefined;
  private readonly calls = new Map<string, Call>();

  constructor(private readonly o: CursorAcpMapperOptions) {
    this.model = o.model;
    this.mode = o.mode;
    this.redact = o.redact ?? ((t) => t);
  }

  /** The model the next messages are named with. */
  setModel(model: string | undefined) {
    this.model = model;
  }

  /** The mode Gravita set; an agent's switch to it is not recorded again. */
  setMode(mode: string) {
    this.mode = mode;
  }

  /** A prompt starts: its blocks are named by `turnId` (the user message's id). */
  beginTurn(turnId: string): GravitaEvent[] {
    const out = this.flush();
    this.turnId = turnId;
    this.blocks = 0;
    this.plans = 0;
    return out;
  }

  /**
   * The prompt answered: the last block, the calls the turn left open (failed when it was
   * cancelled or failed), and the turn's end.
   */
  endTurn(end: { stopReason?: string; error?: string }): GravitaEvent[] {
    const out = this.flush();
    const cancelled = end.stopReason === "cancelled";
    for (const [id, c] of this.calls) {
      if (c.done) continue;
      c.done = true;
      const toolUseId = cursorCallId(this.o.acpSessionId, id);
      out.push({
        ...this.base(),
        key: keys.toolCompleted(toolUseId),
        type: "tool.completed",
        data: { toolUseId, ok: false, error: cancelled ? "Turn interrupted" : "Turn ended" },
      });
    }
    const turnId = this.turnId ?? `loose-${this.loose}`;
    const subtype = end.error
      ? "error_during_execution"
      : cancelled
        ? "interrupted"
        : end.stopReason && end.stopReason !== "end_turn"
          ? end.stopReason
          : undefined;
    out.push({
      ...this.base(),
      key: keys.turnCompleted(this.o.sessionId, turnId),
      type: "turn.completed",
      data: subtype ? { subtype } : {},
    });
    if (end.error)
      out.push({
        ...this.base(),
        key: `error:${this.o.sessionId}:turn:${turnId}`,
        type: "error",
        data: { kind: "turn", message: preview(this.redact(end.error)), retryable: true },
      });
    this.turnId = undefined;
    this.loose++;
    return out;
  }

  /** What Gravita knows of a tool call so far (a permission request restates only part). */
  toolCall(toolCallId: string, asked?: ToolCall): ToolCall {
    const known = this.calls.get(toolCallId)?.call;
    return known ? { ...known, ...definedOf(asked) } : (asked ?? { toolCallId });
  }

  map(n: SessionNotification): GravitaEvent[] {
    const u = n.update;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        return this.chunk("text", textOf(u.content));
      case "agent_thought_chunk":
        return this.chunk("thinking", textOf(u.content));
      case "tool_call":
      case "tool_call_update":
        return [...this.flush(), ...this.tool(u)];
      case "plan":
        return [...this.flush(), ...this.plan(u.entries)];
      case "current_mode_update":
        return this.modeUpdate(u.currentModeId);
      case "session_info_update":
        return this.titled(u.title);
      case "user_message_chunk":
      case "available_commands_update":
        return [];
      default:
        this.o.onUnknown?.(String((u as { sessionUpdate?: unknown }).sessionUpdate));
        return [];
    }
  }

  private base() {
    return {
      ts: this.o.now(),
      source: "cursor-acp" as const,
      provider: "cursor" as const,
      projectId: this.o.projectId,
      sessionId: this.o.sessionId,
      agentId: MAIN_AGENT,
    };
  }

  private turnKey(): string {
    return this.turnId ?? `loose-${this.loose}`;
  }

  private chunk(kind: Block["kind"], text: string): GravitaEvent[] {
    if (!text) return [];
    if (this.block?.kind === kind) {
      this.block.text += text;
      return [];
    }
    const out = this.flush();
    this.block = {
      kind,
      messageId: cursorMessageId(this.o.acpSessionId, this.turnKey(), this.blocks++),
      text,
    };
    return out;
  }

  /** The block in progress, as its event. */
  private flush(): GravitaEvent[] {
    const b = this.block;
    this.block = undefined;
    if (!b) return [];
    if (b.kind === "thinking")
      return [
        {
          ...this.base(),
          key: keys.assistantBlock(b.messageId, "thinking", "0"),
          type: "thinking",
          data: { messageId: b.messageId },
        },
      ];
    const text = this.redact(b.text).trim();
    if (!text) return [];
    this.o.onAssistant?.(b.messageId, text);
    return [
      {
        ...this.base(),
        key: keys.assistantBlock(b.messageId, "text", "0"),
        type: "message.assistant",
        data: {
          messageId: b.messageId,
          textPreview: preview(text),
          ...(this.model ? { model: this.model } : {}),
        },
      },
    ];
  }

  private tool(u: ToolCall): GravitaEvent[] {
    const id = u.toolCallId;
    if (typeof id !== "string" || !id) return [];
    const seen = this.calls.get(id);
    const call: ToolCall = seen ? { ...seen.call, ...definedOf(u) } : { ...u };
    const c: Call = seen ?? { call, started: false, done: false };
    c.call = call;
    this.calls.set(id, c);
    const out: GravitaEvent[] = [];
    const toolUseId = cursorCallId(this.o.acpSessionId, id);
    if (!c.started) {
      c.started = true;
      out.push({
        ...this.base(),
        key: keys.toolStarted(toolUseId),
        type: "tool.started",
        data: {
          toolUseId,
          name: cursorToolName(call),
          kind: cursorToolKind(call),
          target: this.redactTarget(cursorToolTarget(call)),
          inputPreview: preview(this.redact(cursorInputPreview(call))),
        },
      });
    }
    if (!c.done && (call.status === "completed" || call.status === "failed")) {
      c.done = true;
      const ok = call.status === "completed";
      const output = preview(this.redact(outputOf(call)));
      const files = ok && WRITES.has(String(call.kind)) ? cursorPaths(call) : [];
      out.push({
        ...this.base(),
        key: keys.toolCompleted(toolUseId),
        type: "tool.completed",
        data: {
          toolUseId,
          ok,
          ...(output && ok ? { outputPreview: output } : {}),
          ...(!ok ? { error: output || "The tool call failed" } : {}),
          ...(files.length ? { fileChanges: files.map((path) => ({ path })) } : {}),
        },
      });
    }
    return out;
  }

  private redactTarget(t: ToolTarget): ToolTarget {
    const out: ToolTarget = {};
    for (const [k, v] of Object.entries(t) as [keyof ToolTarget, string | undefined][])
      if (v) out[k] = this.redact(v);
    return out;
  }

  private plan(entries: unknown): GravitaEvent[] {
    if (!Array.isArray(entries)) return [];
    const items = entries.flatMap((e) => {
      if (!e || typeof e !== "object") return [];
      const { content, status } = e as { content?: unknown; status?: unknown };
      if (typeof content !== "string" || !content.trim()) return [];
      return [
        {
          content: preview(this.redact(content)),
          status: typeof status === "string" ? status : "pending",
        },
      ];
    });
    if (!items.length) return [];
    return [
      {
        ...this.base(),
        key: `todo:${this.o.sessionId}:${this.turnKey()}:${this.plans++}`,
        type: "todo.updated",
        data: { items },
      },
    ];
  }

  /** The agent switched mode on its own: recorded as the session's setting. */
  private modeUpdate(mode: string): GravitaEvent[] {
    if (!isCursorMode(mode) || mode === this.mode) return [];
    this.mode = mode;
    const ts = this.o.now();
    return [
      {
        ...this.base(),
        ts,
        key: `${keys.sessionSettings(this.o.sessionId, Date.parse(ts) || 0)}:cursor-mode:${mode}`,
        type: "session.settings",
        data: settingsModeOf("cursor", mode),
      },
    ];
  }

  private titled(title: string | null | undefined): GravitaEvent[] {
    const text = typeof title === "string" ? preview(this.redact(title)) : "";
    if (!text) return [];
    return [
      {
        ...this.base(),
        key: `session:${this.o.sessionId}:title:acp:${hash(text)}`,
        type: "session.titled",
        data: { title: text },
      },
    ];
  }
}

/** The fields an update sets (an update restates only what changed). */
function definedOf(u: ToolCall | undefined): Partial<ToolCall> {
  if (!u) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(u))
    if (v !== undefined && v !== null && k !== "sessionUpdate") out[k] = v;
  return out as Partial<ToolCall>;
}
