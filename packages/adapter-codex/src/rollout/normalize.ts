import { createHash } from "node:crypto";
import { codexPlanUsage } from "@gravita/core";
import { type GravitaEvent, keys, MAIN_AGENT } from "@gravita/protocol";
import { preview, stableJson } from "@gravita/protocol/tools";
import { codexCallId, codexItemId } from "../ids";
import { fileChangesOf, parsePatch } from "../patch";
import {
  APPLY_PATCH,
  CODE_MODE,
  codeModePatch,
  codexInputPreview,
  codexToolKindOf,
  codexToolName,
  codexToolTarget,
  patchTextOf,
  SPAWN_AGENT,
  UPDATE_PLAN,
} from "../tools";
import {
  isObject,
  type Loose,
  num,
  obj,
  type RolloutLine,
  sessionMetaOf,
  str,
  THREAD_ID,
  textParts,
  typedText,
} from "./records";

// Maps the records of ONE rollout (one thread) to Gravita events. A rollout is read
// incrementally, and a few facts span records (the turn in progress, the model, the calls
// waiting for their output), so the mapper keeps a small serializable state. Same records
// in the same order → same events with the same keys, however the file was split into polls.

/** Where a thread's events go. */
export interface ThreadContext {
  projectId: string;
  /** The Gravita session: "codex:<root thread id>". */
  sessionId: string;
  /** "main" for the root thread, "codex:<thread id>" for a subagent. */
  agentId: string;
  /** This rollout's own thread id. */
  threadId: string;
  /** Absolute path of the rollout, for outputRef pointers. */
  filePath: string;
  /**
   * Where the records come from: the rollout on disk, or the app-server's live stream
   * (`CodexRpcMapper` replays its raw response items through this same mapping).
   */
  source?: "codex-rollout" | "codex-rpc";
}

interface PendingCall {
  name: string;
  /** apply_patch: the files its patch changes, reported on completion. */
  files?: { path: string; added: number; removed: number }[];
}

/** The mapper's progress through one rollout; JSON-safe, kept in tail checkpoints. */
export interface ThreadState {
  /** `session_meta` was read and `session.started` waits for the next record (its model). */
  pendingStart?: {
    ts: string;
    cwd: string;
    cliVersion?: string;
    originator?: string;
    branch?: string;
  };
  started: boolean;
  model?: string;
  turnId?: string;
  /** A turn started and has not completed or been aborted yet. */
  openTurn: boolean;
  /** Cumulative total of the last token count reported: repeats carry the same total. */
  lastTotal?: number;
  /** The last rate limits reported, so a repeated reading isn't sent again. */
  lastLimits?: string;
  /** Calls whose output hasn't been read yet. */
  calls: Record<string, PendingCall>;
  /** Child thread id → the spawn_agent call (toolUseId) that started it. */
  spawned: Record<string, string>;
  /**
   * A typed user message whose key waits for the next record: Codex follows it with an
   * `item_completed` that carries the client's own message id when a client (Gravita)
   * gave one, and that id is the key Gravita already stored the message under.
   */
  pendingUser?: { ts: string; text: string; id?: string };
  /**
   * How many items of each kind without an id of their own the current turn has had: their
   * keys count them, as the live stream and the rollout see the same items in the same order.
   */
  ordinals?: { turn: string; seen: Record<string, number> };
  /** Turns this thread has ended: a subagent's later turns complete under keys of their own. */
  turnsEnded?: number;
  /** A subagent's last reply in the current turn, its summary when the turn's end has none. */
  lastReply?: string;
}

export function newThreadState(): ThreadState {
  return { started: false, openTurn: false, calls: {}, spawned: {} };
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

function parseArgs(raw: unknown): Loose {
  if (isObject(raw)) return raw;
  if (typeof raw !== "string") return {};
  try {
    const v: unknown = JSON.parse(raw);
    return isObject(v) ? v : {};
  } catch {
    return {};
  }
}

/** The text of a tool output: a string, content parts, or `{content, success}`. */
function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return textParts(output).join("\n");
  if (isObject(output)) {
    const content = output.content;
    return typeof content === "string" ? content : textParts(content).join("\n");
  }
  return "";
}

/** Whether a tool output reports success, from the few signals Codex writes. */
function outputOk(name: string, output: unknown, text: string): boolean {
  if (isObject(output) && typeof output.success === "boolean") return output.success;
  const exit = text.match(/Process exited with code (-?\d+)/);
  if (exit) return exit[1] === "0";
  // A script that failed, or a call cut short by an interrupt.
  if (/^(Script failed|aborted by user)\b/m.test(text)) return false;
  if (text.trim().startsWith("{")) {
    // Older versions: `{"output": "...", "metadata": {"exit_code": 1}}`.
    const code = num(obj(parseArgs(text), "metadata"), "exit_code");
    if (code !== undefined) return code === 0;
  }
  if (name === APPLY_PATCH && /^(error|failed)\b/i.test(text.trim())) return false;
  return true;
}

/** The thread a spawn_agent output names: `agent_id`/`thread_id`, else the first UUID. */
function spawnedThreadOf(text: string): string | undefined {
  const args = parseArgs(text);
  for (const key of ["agent_id", "thread_id", "id"]) {
    const v = str(args, key)?.toLowerCase();
    if (v && THREAD_ID.test(v)) return v;
  }
  return text
    .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
    ?.toLowerCase();
}

/** update_plan's steps as todo items. */
function planItems(args: Loose): { content: string; status: string }[] | undefined {
  const plan = args.plan;
  if (!Array.isArray(plan)) return undefined;
  return plan.filter(isObject).map((s) => ({
    content: String(s.step ?? s.content ?? ""),
    status: String(s.status ?? ""),
  }));
}

export class RolloutNormalizer {
  readonly state: ThreadState;
  private readonly isMain: boolean;

  constructor(
    private readonly ctx: ThreadContext,
    state?: ThreadState,
  ) {
    this.state = state ?? newThreadState();
    this.isMain = ctx.agentId === MAIN_AGENT;
  }

  /** Maps the next records of the rollout, in file order. */
  push(lines: readonly RolloutLine[]): GravitaEvent[] {
    const out: GravitaEvent[] = [];
    for (const line of lines) {
      if (this.state.pendingUser) this.flushUser(out, line);
      // The session starts at its first turn context (which names the model) or at the
      // first record that means something, whichever comes first.
      if (line.type === "turn_context") this.flushStart(out, line);
      const own: GravitaEvent[] = [];
      this.record(own, line);
      if (own.length) this.flushStart(out, line);
      out.push(...own);
    }
    return out;
  }

  private base(ts: string | undefined) {
    return {
      ts: ts ?? "",
      source: this.ctx.source ?? "codex-rollout",
      provider: "codex" as const,
      projectId: this.ctx.projectId,
      sessionId: this.ctx.sessionId,
      agentId: this.ctx.agentId,
    };
  }

  /** `session.started` for the root thread, with the model when `next` is a turn context. */
  private flushStart(out: GravitaEvent[], next: RolloutLine) {
    const s = this.state;
    const p = s.pendingStart;
    if (!p) return;
    delete s.pendingStart;
    s.started = true;
    const model = next.type === "turn_context" ? str(next.payload, "model") : undefined;
    out.push({
      ...this.base(p.ts),
      key: keys.sessionStarted(this.ctx.sessionId),
      type: "session.started",
      data: {
        kind: "external",
        cwd: p.cwd,
        ...(p.branch ? { gitBranch: p.branch } : {}),
        ...(model ? { model } : {}),
        ...(p.originator ? { entrypoint: p.originator } : {}),
        ...(p.cliVersion ? { cliVersion: p.cliVersion } : {}),
      },
    });
  }

  private record(out: GravitaEvent[], r: RolloutLine) {
    const p = r.payload;
    switch (r.type) {
      case "session_meta": {
        const meta = sessionMetaOf(r);
        if (!this.isMain || this.state.started || this.state.pendingStart || !meta?.cwd) return;
        this.state.pendingStart = {
          ts: meta.ts ?? r.timestamp ?? "",
          cwd: meta.cwd,
          ...(meta.cliVersion ? { cliVersion: meta.cliVersion } : {}),
          ...(meta.originator ? { originator: meta.originator } : {}),
          ...(meta.gitBranch ? { branch: meta.gitBranch } : {}),
        };
        return;
      }
      case "turn_context": {
        const model = str(p, "model");
        if (model) this.state.model = model;
        const turnId = str(p, "turn_id");
        if (turnId) this.state.turnId = turnId;
        return;
      }
      case "event_msg":
        this.event(out, r);
        return;
      case "response_item":
        this.item(out, r);
        return;
      case "compacted":
        this.compacted(out, r, "auto");
        return;
      // world_state, token_usage_record, retained_context and anything newer: ignored.
    }
  }

  /**
   * Emits the user message held back for one record. When `next` is its `item_completed`
   * with a client message id, that id is the message's uuid (a message Gravita sent keeps
   * the key it was stored under); otherwise it is keyed by its own id, as always.
   */
  private flushUser(out: GravitaEvent[], next: RolloutLine) {
    const u = this.state.pendingUser!;
    delete this.state.pendingUser;
    const item = next.type === "event_msg" ? obj(next.payload, "item") : undefined;
    const clientId =
      next.payload.type === "item_completed" && str(item, "type") === "UserMessage"
        ? str(item, "client_id")
        : undefined;
    const uuid =
      clientId ?? codexItemId(this.ctx.threadId, u.id ?? `u${hash(`${u.ts}:${u.text}`)}`);
    // The session may start at this message (its first meaningful record).
    this.flushStart(out, next);
    out.push({
      ...this.base(u.ts),
      key: keys.userMessage(uuid),
      type: "message.user",
      // Another client's id says nothing of who typed it: Gravita's own copy came first.
      data: { uuid, textPreview: preview(u.text), origin: "human" },
    });
  }

  private compacted(out: GravitaEvent[], r: RolloutLine, trigger: string) {
    out.push({
      ...this.base(r.timestamp),
      key: `compact:${codexItemId(this.ctx.threadId, this.compactionId(r))}`,
      type: "compact.happened",
      data: { trigger },
    });
  }

  /**
   * A compaction's id: its encrypted summary, which the response item carries and a
   * `compacted` record keeps in its replacement history, or else its place in the turn.
   */
  private compactionId(r: RolloutLine): string {
    const p = r.payload;
    let summary = r.type === "response_item" ? str(p, "encrypted_content") : undefined;
    const history = r.type === "compacted" ? p.replacement_history : undefined;
    if (Array.isArray(history)) {
      for (const item of history) {
        if (isObject(item) && (item.type === "compaction" || item.type === "context_compaction"))
          summary = str(item, "encrypted_content") ?? summary;
      }
    }
    return summary ? `c${hash(summary)}` : this.ordinal("c", "");
  }

  /**
   * The id of an item that has none of its own, the same from the rollout and from the live
   * stream (which stamps records with its own clock): the turn, the item's place among the
   * turn's items of its kind, and what it says. Never the record's time.
   */
  private ordinal(kind: string, content: string): string {
    const s = this.state;
    const turn = s.turnId ?? "";
    if (s.ordinals?.turn !== turn) s.ordinals = { turn, seen: {} };
    const n = (s.ordinals.seen[kind] ?? 0) + 1;
    s.ordinals.seen[kind] = n;
    return `${kind}${hash(`${turn}:${n}:${content}`)}`;
  }

  private event(out: GravitaEvent[], r: RolloutLine) {
    const p = r.payload;
    const s = this.state;
    switch (p.type) {
      case "task_started": {
        s.openTurn = true;
        const turnId = str(p, "turn_id");
        if (turnId) s.turnId = turnId;
        delete s.lastReply;
        // A subagent given more work after its task ended is at work again.
        if (!this.isMain && s.turnsEnded) {
          out.push({
            ...this.base(r.timestamp),
            key: keys.agentLifecycle(
              this.ctx.sessionId,
              this.ctx.agentId,
              `running:${this.turnKey(r)}`,
            ),
            type: "agent.lifecycle",
            data: { status: "running", resumed: true },
          });
        }
        return;
      }
      case "task_complete": {
        s.openTurn = false;
        const error = obj(p, "error");
        const message = str(error, "message");
        if (error) {
          out.push({
            ...this.base(r.timestamp),
            key: `error:${codexItemId(this.ctx.threadId, `turn:${this.turnKey(r)}`)}`,
            type: "error",
            data: {
              kind: "turn_failed",
              message: message ? preview(message) : "The turn failed",
              retryable: false,
            },
          });
        }
        const durationMs = num(p, "duration_ms");
        const summary = str(p, "last_agent_message");
        this.endTurn(out, r, error ? "failed" : "completed", durationMs, summary);
        return;
      }
      case "turn_aborted": {
        s.openTurn = false;
        this.endTurn(out, r, "aborted", num(p, "duration_ms"), undefined, str(p, "reason"));
        return;
      }
      case "token_count":
        this.tokens(out, r);
        return;
      case "error": {
        const message = str(p, "message");
        if (!message) return;
        out.push({
          ...this.base(r.timestamp),
          key: `error:${codexItemId(this.ctx.threadId, hash(`${r.timestamp}:${message}`))}`,
          type: "error",
          data: { kind: "codex_error", message: preview(message), retryable: false },
        });
        return;
      }
      // user_message / agent_message / item_completed repeat what the response items say;
      // reasoning deltas, exec begin/end, mcp begin/end and the rest are not needed.
    }
  }

  /** The current turn's id, or one derived from the record when none was announced. */
  private turnKey(r: RolloutLine): string {
    return str(r.payload, "turn_id") ?? this.state.turnId ?? hash(r.timestamp ?? "");
  }

  private endTurn(
    out: GravitaEvent[],
    r: RolloutLine,
    outcome: "completed" | "failed" | "aborted",
    durationMs: number | undefined,
    summary?: string,
    reason?: string,
  ) {
    const s = this.state;
    if (outcome === "aborted") {
      // Unanswered calls of an aborted turn will never complete: they failed.
      for (const callId of Object.keys(s.calls)) {
        const toolUseId = codexCallId(callId);
        out.push({
          ...this.base(r.timestamp),
          key: keys.toolCompleted(toolUseId),
          type: "tool.completed",
          data: { toolUseId, ok: false, error: `Turn ${reason ?? "aborted"}` },
        });
      }
      s.calls = {};
    }
    if (this.isMain) {
      out.push({
        ...this.base(r.timestamp),
        key: keys.turnCompleted(this.ctx.sessionId, `${this.ctx.threadId}:${this.turnKey(r)}`),
        type: "turn.completed",
        data: {
          ...(outcome !== "completed" ? { subtype: reason ?? outcome } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        },
      });
    } else {
      // A subagent's task ends with its turn; its parent hears through wait_agent. The
      // first turn's end keeps the key it always had; a later turn (more work sent to the
      // subagent) ends under its own.
      const completed = keys.agentCompleted(this.ctx.sessionId, this.ctx.agentId);
      const text = summary ? preview(summary) : s.lastReply;
      out.push({
        ...this.base(r.timestamp),
        key: s.turnsEnded ? `${completed}:${this.turnKey(r)}` : completed,
        type: "agent.completed",
        data: {
          status:
            outcome === "completed" ? "completed" : outcome === "failed" ? "failed" : "stopped",
          ...(text ? { summary: text } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
        },
      });
    }
    s.turnsEnded = (s.turnsEnded ?? 0) + 1;
  }

  private tokens(out: GravitaEvent[], r: RolloutLine) {
    const p = r.payload;
    const info = obj(p, "info");
    const last = obj(info, "last_token_usage");
    const total = num(obj(info, "total_token_usage"), "total_tokens");
    if (last && total !== undefined && total !== this.state.lastTotal) {
      this.state.lastTotal = total;
      // Codex counts cached (and cache-written) tokens inside input_tokens and reasoning
      // inside output_tokens; Gravita's input is the uncached part, like Claude's.
      const input = num(last, "input_tokens") ?? 0;
      const cacheRead = num(last, "cached_input_tokens") ?? 0;
      const cacheWrite = num(last, "cache_write_input_tokens") ?? 0;
      const output = num(last, "output_tokens") ?? 0;
      const messageId = codexItemId(this.ctx.threadId, `usage:${total}`);
      const contextWindow = num(info, "model_context_window");
      out.push({
        ...this.base(r.timestamp),
        key: `${keys.usage(messageId)}:${output}`,
        type: "usage.reported",
        data: {
          messageId,
          ...(this.state.model ? { model: this.state.model } : {}),
          input: Math.max(0, input - cacheRead - cacheWrite),
          output,
          cacheRead,
          cacheWrite,
          ...(contextWindow && contextWindow > 0 ? { contextWindow } : {}),
        },
      });
    }
    const limits = p.rate_limits;
    if (!isObject(limits)) return;
    const reading = stableJson(limits);
    if (reading === this.state.lastLimits) return;
    this.state.lastLimits = reading;
    const nowMs = Date.parse(r.timestamp ?? "") || 0;
    for (const w of codexPlanUsage(limits, nowMs)) {
      out.push({
        key: keys.usageLimits("codex", w.window, w.model, `${this.ctx.threadId}:${r.timestamp}`),
        ts: r.timestamp ?? "",
        source: this.ctx.source ?? "codex-rollout",
        provider: "codex",
        projectId: this.ctx.projectId,
        type: "usage.limits",
        data: { provider: "codex", ...w },
      });
    }
  }

  private item(out: GravitaEvent[], r: RolloutLine) {
    const p = r.payload;
    const ts = r.timestamp;
    switch (p.type) {
      case "message": {
        const role = str(p, "role");
        if (role === "user") {
          const text = typedText(p.content);
          if (!text) return;
          // Keyed once the next record tells whether a client named it (flushUser).
          const id = str(p, "id");
          this.state.pendingUser = { ts: ts ?? "", text, ...(id ? { id } : {}) };
        } else if (role === "assistant") {
          const text = textParts(p.content).join("\n\n").trim();
          if (!text) return;
          const messageId = codexItemId(this.ctx.threadId, str(p, "id") ?? this.ordinal("m", text));
          if (!this.isMain) this.state.lastReply = preview(text);
          out.push({
            ...this.base(ts),
            key: keys.assistantBlock(messageId, "text", hash(text)),
            type: "message.assistant",
            data: {
              messageId,
              textPreview: preview(text),
              ...(this.state.model ? { model: this.state.model } : {}),
            },
          });
        }
        // developer/system messages are Codex's own instructions.
        return;
      }
      case "reasoning": {
        // Encrypted; only the fact that the model thought is shown.
        const messageId = codexItemId(
          this.ctx.threadId,
          str(p, "id") ?? this.ordinal("r", str(p, "encrypted_content") ?? ""),
        );
        out.push({
          ...this.base(ts),
          key: keys.assistantBlock(messageId, "thinking", "0"),
          type: "thinking",
          data: { messageId },
        });
        return;
      }
      case "function_call": {
        const callId = str(p, "call_id");
        const raw = str(p, "name");
        if (!callId || !raw) return;
        this.startTool(
          out,
          ts,
          callId,
          codexToolName(raw, str(p, "namespace")),
          parseArgs(p.arguments),
        );
        return;
      }
      case "custom_tool_call": {
        const callId = str(p, "call_id");
        const name = str(p, "name");
        if (!callId || !name) return;
        this.startTool(out, ts, callId, name, typeof p.input === "string" ? p.input : "");
        return;
      }
      case "local_shell_call": {
        const callId = str(p, "call_id") ?? str(p, "id");
        if (!callId) return;
        this.startTool(out, ts, callId, "local_shell", obj(p, "action") ?? {});
        return;
      }
      case "function_call_output":
      case "custom_tool_call_output":
      case "local_shell_call_output": {
        const callId = str(p, "call_id");
        if (callId) this.completeTool(out, ts, callId, p.output);
        return;
      }
      case "web_search_call":
        this.webSearch(out, r);
        return;
      case "compaction":
        this.compacted(out, r, "auto");
        return;
    }
  }

  private startTool(
    out: GravitaEvent[],
    ts: string | undefined,
    callId: string,
    name: string,
    input: Loose | string,
  ) {
    const toolUseId = codexCallId(callId);
    const call: PendingCall = { name };
    // A code-mode script may apply patches too; their files are the script's changes.
    const patchText =
      name === APPLY_PATCH
        ? patchTextOf(input)
        : name === CODE_MODE && typeof input === "string"
          ? codeModePatch(input)
          : "";
    const patch = parsePatch(patchText);
    if (patch.length) call.files = fileChangesOf(patch);
    this.state.calls[callId] = call;
    const kind = codexToolKindOf(name, input);
    out.push({
      ...this.base(ts),
      key: keys.toolStarted(toolUseId),
      type: "tool.started",
      data: {
        toolUseId,
        name,
        kind,
        target: codexToolTarget(name, input),
        inputPreview: codexInputPreview(name, input),
      },
    });
    if (name === UPDATE_PLAN && typeof input !== "string") {
      const items = planItems(input);
      if (items) {
        out.push({
          ...this.base(ts),
          key: `todo:${toolUseId}`,
          type: "todo.updated",
          data: { items },
        });
      }
    }
  }

  private completeTool(
    out: GravitaEvent[],
    ts: string | undefined,
    callId: string,
    output: unknown,
  ) {
    const call = this.state.calls[callId];
    delete this.state.calls[callId];
    const name = call?.name ?? "";
    const toolUseId = codexCallId(callId);
    const text = outputText(output);
    const ok = outputOk(name, output, text);
    if (name === SPAWN_AGENT) {
      const child = spawnedThreadOf(text);
      if (child) this.state.spawned[child] = toolUseId;
    }
    out.push({
      ...this.base(ts),
      key: keys.toolCompleted(toolUseId),
      type: "tool.completed",
      data: {
        toolUseId,
        ok,
        ...(text ? { outputPreview: preview(text) } : {}),
        outputRef: { path: this.ctx.filePath, uuid: callId },
        ...(!ok && text ? { error: preview(text) } : {}),
        ...(ok && call?.files?.length ? { fileChanges: call.files } : {}),
      },
    });
  }

  /** A web search is one record: it starts and completes at once. */
  private webSearch(out: GravitaEvent[], r: RolloutLine) {
    const p = r.payload;
    const action = obj(p, "action");
    const queries = action?.queries;
    const query =
      str(action, "query") ??
      (Array.isArray(queries) && typeof queries[0] === "string" ? queries[0] : undefined);
    const url = str(action, "url");
    const id = str(p, "id") ?? this.ordinal("ws", query ?? url ?? "");
    const toolUseId = codexCallId(id);
    const target = { ...(query ? { query } : {}), ...(url ? { url } : {}) };
    out.push({
      ...this.base(r.timestamp),
      key: keys.toolStarted(toolUseId),
      type: "tool.started",
      data: {
        toolUseId,
        name: "web_search",
        kind: "web",
        target,
        inputPreview: preview(query ?? url ?? "web search"),
      },
    });
    const status = str(p, "status");
    if (status === "in_progress") return;
    out.push({
      ...this.base(r.timestamp),
      key: keys.toolCompleted(toolUseId),
      type: "tool.completed",
      data: { toolUseId, ok: status !== "failed" },
    });
  }
}
