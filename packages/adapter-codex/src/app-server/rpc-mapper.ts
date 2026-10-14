import { createHash } from "node:crypto";
import { codexPlanUsage } from "@gravita/core";
import { type GravitaEvent, keys, MAIN_AGENT } from "@gravita/protocol";
import { preview } from "@gravita/protocol/tools";
import { codexAgentId, codexCallId, codexItemId } from "../ids";
import { newThreadState, RolloutNormalizer } from "../rollout/normalize";
import { isObject, type Loose, type RolloutLine } from "../rollout/records";
import { codexToolKind } from "../tools";
import type { ServerNotification } from "./methods";
import type { Thread as CodexThread, ThreadItem, TokenUsageBreakdown, Turn } from "./protocol";

// Maps the live stream of `codex app-server` to Gravita events, with the SAME keys the
// rollout reader gives the same facts, so when the rollout is read later (the chat ended,
// the engine restarted) nothing is stored twice.
//
// It does so by construction: the app-server's raw response items are the records Codex
// writes to the rollout, so they go through the rollout's own mapping (RolloutNormalizer),
// and the turn and token notifications are restated as the rollout records they stand for
// (task_started, task_complete / turn_aborted, token_count). The app-server's own items
// (`item/*`) name things differently: a command run inside a code-mode script is an item of
// its own, while the rollout shows the script's call, and messages carry item ids of their
// own. They are only mapped when raw items aren't available (`rawItems: false`), and then
// dedupe with the rollout isn't guaranteed.
//
// What the user typed is not mapped: Gravita stored it when it sent it, under the id it
// gave Codex as `clientUserMessageId` (which the rollout reader also keys it by).

export interface CodexRpcMapperOptions {
  projectId: string;
  /** "codex:<root thread id>". */
  sessionId: string;
  rootThreadId: string;
  /** The root thread's rollout, when Codex tells it (outputRef pointers). */
  rolloutPath?: string;
  /** The model the session runs (named on each turn's context). */
  model?: string;
  /** Map raw response items (true, the default) or, without them, the app-server's items. */
  rawItems?: boolean;
  now: () => string;
}

interface Thread {
  normalizer: RolloutNormalizer;
  agentId: string;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/** The app-server's token counts in the rollout's spelling. */
function snakeUsage(u: TokenUsageBreakdown): Loose {
  return {
    input_tokens: u.inputTokens,
    cached_input_tokens: u.cachedInputTokens,
    cache_write_input_tokens: u.cacheWriteInputTokens,
    output_tokens: u.outputTokens,
    reasoning_output_tokens: u.reasoningOutputTokens,
    total_tokens: u.totalTokens,
  };
}

/** A user message among raw items: Gravita already has it. */
const isUserMessage = (item: unknown) =>
  isObject(item) && item.type === "message" && item.role === "user";

export class CodexRpcMapper {
  private readonly threads = new Map<string, Thread>();
  private model: string | undefined;
  private readonly rawItems: boolean;
  /** File change item → the paths it writes (an approval names only the item). */
  private readonly changes = new Map<string, string[]>();

  constructor(private readonly o: CodexRpcMapperOptions) {
    this.model = o.model;
    this.rawItems = o.rawItems ?? true;
    this.track(o.rootThreadId.toLowerCase(), MAIN_AGENT, o.rolloutPath ?? "");
  }

  /** The model the next turns run on. */
  setModel(model: string | undefined) {
    this.model = model;
  }

  /** The paths a file change writes, once its item started; for an approval's preview. */
  fileChangePaths(itemId: string): string[] | undefined {
    return this.changes.get(itemId);
  }

  map(n: ServerNotification): GravitaEvent[] {
    switch (n.method) {
      case "thread/started":
        return this.threadStarted(n.params.thread);
      case "turn/started":
        return this.turnStarted(n.params.threadId, n.params.turn);
      case "turn/completed":
        return this.turnCompleted(n.params.threadId, n.params.turn);
      case "rawResponseItem/completed": {
        const { item } = n.params;
        if (!this.rawItems || isUserMessage(item)) return [];
        return this.push(n.params.threadId, [
          { type: "response_item", timestamp: this.o.now(), payload: item as unknown as Loose },
        ]);
      }
      case "thread/tokenUsage/updated": {
        const u = n.params.tokenUsage;
        return this.push(n.params.threadId, [
          {
            type: "event_msg",
            timestamp: this.o.now(),
            payload: {
              type: "token_count",
              info: {
                total_token_usage: snakeUsage(u.total),
                last_token_usage: snakeUsage(u.last),
                model_context_window: u.modelContextWindow,
              },
            },
          },
        ]);
      }
      case "account/rateLimits/updated":
        return this.rateLimits(n.params.rateLimits);
      case "item/started":
        this.noteChange(n.params.item);
        return this.rawItems ? [] : this.itemStarted(n.params.threadId, n.params.item);
      case "item/completed":
        return this.rawItems ? [] : this.itemCompleted(n.params.threadId, n.params.item);
      default:
        return [];
    }
  }

  private track(threadId: string, agentId: string, filePath: string): Thread {
    const normalizer = new RolloutNormalizer(
      {
        projectId: this.o.projectId,
        sessionId: this.o.sessionId,
        agentId,
        threadId,
        filePath,
        source: "codex-rpc",
      },
      // The session itself was started (and announced) by Gravita.
      { ...newThreadState(), started: true },
    );
    const t = { normalizer, agentId };
    this.threads.set(threadId, t);
    return t;
  }

  private push(threadId: string, lines: RolloutLine[]): GravitaEvent[] {
    const t = this.threads.get(threadId.toLowerCase());
    return t ? t.normalizer.push(lines) : [];
  }

  private base(threadId: string) {
    const t = this.threads.get(threadId.toLowerCase());
    return {
      ts: this.o.now(),
      source: "codex-rpc" as const,
      provider: "codex" as const,
      projectId: this.o.projectId,
      sessionId: this.o.sessionId,
      agentId: t?.agentId ?? MAIN_AGENT,
    };
  }

  /** A subagent thread joins the session (keyed as the rollout reader keys its spawn). */
  private threadStarted(thread: CodexThread): GravitaEvent[] {
    const threadId = thread.id.toLowerCase();
    if (this.threads.has(threadId) || !thread.parentThreadId) return [];
    const parent = this.threads.get(thread.parentThreadId.toLowerCase());
    if (!parent) return [];
    const agentId = codexAgentId(threadId);
    this.track(threadId, agentId, thread.path ?? "");
    return [
      {
        ...this.base(threadId),
        key: keys.agentSpawned(this.o.sessionId, agentId),
        type: "agent.spawned",
        data: {
          parentAgentId: parent.agentId,
          agentType: thread.agentRole ?? "default",
          ...(thread.agentNickname ? { description: thread.agentNickname } : {}),
          depth: parent.agentId === MAIN_AGENT ? 1 : 2,
          background: false,
        },
      },
    ];
  }

  private turnStarted(threadId: string, turn: Turn): GravitaEvent[] {
    const ts = this.o.now();
    return this.push(threadId, [
      {
        type: "turn_context",
        timestamp: ts,
        payload: { turn_id: turn.id, ...(this.model ? { model: this.model } : {}) },
      },
      { type: "event_msg", timestamp: ts, payload: { type: "task_started", turn_id: turn.id } },
    ]);
  }

  private turnCompleted(threadId: string, turn: Turn): GravitaEvent[] {
    const duration = turn.durationMs !== null ? { duration_ms: turn.durationMs } : {};
    const payload: Loose =
      turn.status === "interrupted"
        ? { type: "turn_aborted", turn_id: turn.id, reason: "interrupted", ...duration }
        : {
            type: "task_complete",
            turn_id: turn.id,
            ...duration,
            ...(turn.status === "failed"
              ? { error: { message: turn.error?.message ?? "The turn failed" } }
              : {}),
          };
    return this.push(threadId, [{ type: "event_msg", timestamp: this.o.now(), payload }]);
  }

  private rateLimits(limits: unknown): GravitaEvent[] {
    const ts = this.o.now();
    const nowMs = Date.parse(ts) || 0;
    return codexPlanUsage(limits, nowMs).map((w) => ({
      key: keys.usageLimits("codex", w.window, w.model, `rpc:${this.o.sessionId}:${ts}`),
      ts,
      source: "codex-rpc" as const,
      provider: "codex" as const,
      projectId: this.o.projectId,
      type: "usage.limits" as const,
      data: { provider: "codex" as const, ...w },
    }));
  }

  private noteChange(item: ThreadItem) {
    if (item.type !== "fileChange") return;
    const paths: string[] = [];
    for (const c of item.changes) {
      if (!paths.includes(c.path)) paths.push(c.path);
      const moved = c.kind.type === "update" ? c.kind.move_path : null;
      if (moved && !paths.includes(moved)) paths.push(moved);
    }
    this.changes.set(item.id, paths);
  }

  // Without raw items: the app-server's own items.

  private itemStarted(threadId: string, item: ThreadItem): GravitaEvent[] {
    const tool = toolOf(item);
    if (!tool || !this.threads.has(threadId.toLowerCase())) return [];
    const toolUseId = codexCallId(item.id);
    return [
      {
        ...this.base(threadId),
        key: keys.toolStarted(toolUseId),
        type: "tool.started",
        data: {
          toolUseId,
          name: tool.name,
          kind: codexToolKind(tool.name),
          target: tool.target,
          inputPreview: preview(
            tool.target.cmd ?? tool.target.path ?? tool.target.query ?? tool.name,
          ),
        },
      },
    ];
  }

  private itemCompleted(threadId: string, item: ThreadItem): GravitaEvent[] {
    const tid = threadId.toLowerCase();
    if (!this.threads.has(tid)) return [];
    const base = this.base(threadId);
    switch (item.type) {
      case "agentMessage": {
        const text = item.text.trim();
        if (!text) return [];
        const messageId = codexItemId(tid, item.id);
        return [
          {
            ...base,
            key: keys.assistantBlock(messageId, "text", hash(text)),
            type: "message.assistant",
            data: {
              messageId,
              textPreview: preview(text),
              ...(this.model ? { model: this.model } : {}),
            },
          },
        ];
      }
      case "reasoning": {
        const messageId = codexItemId(tid, item.id);
        return [
          {
            ...base,
            key: keys.assistantBlock(messageId, "thinking", "0"),
            type: "thinking",
            data: { messageId },
          },
        ];
      }
    }
    if (!toolOf(item)) return [];
    const toolUseId = codexCallId(item.id);
    const ok = completedOk(item);
    const output = item.type === "commandExecution" ? (item.aggregatedOutput ?? "") : "";
    return [
      {
        ...base,
        key: keys.toolCompleted(toolUseId),
        type: "tool.completed",
        data: {
          toolUseId,
          ok,
          ...(output ? { outputPreview: preview(output) } : {}),
          ...(item.type === "fileChange" && ok
            ? { fileChanges: (this.changes.get(item.id) ?? []).map((path) => ({ path })) }
            : {}),
        },
      },
    ];
  }
}

interface ItemTool {
  name: string;
  target: { cmd?: string; path?: string; query?: string; url?: string };
}

/** The tool an app-server item stands for, in the rollout's tool names. */
function toolOf(item: ThreadItem): ItemTool | undefined {
  switch (item.type) {
    case "commandExecution":
      return { name: "exec_command", target: { cmd: item.command } };
    case "fileChange": {
      const path = item.changes[0]?.path;
      return { name: "apply_patch", target: path ? { path } : {} };
    }
    case "mcpToolCall":
      return { name: `mcp__${item.server}__${item.tool}`, target: {} };
    case "webSearch": {
      const query = typeof item.query === "string" && item.query ? item.query : undefined;
      return { name: "web_search", target: query ? { query } : {} };
    }
    default:
      return undefined;
  }
}

function completedOk(item: ThreadItem): boolean {
  switch (item.type) {
    case "commandExecution":
      return item.status === "completed" && (item.exitCode ?? 0) === 0;
    case "fileChange":
      return item.status === "completed";
    case "mcpToolCall":
      return item.status === "completed" && !item.error;
    default:
      return true;
  }
}
