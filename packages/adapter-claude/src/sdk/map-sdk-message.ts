import { type GravitaEvent, keys, MAIN_AGENT } from "@gravita/protocol";
import { preview } from "../tools";
import { normalizeRecords } from "../transcript/normalize";
import { AGENT_ID, type RawRecord } from "../transcript/records";
import {
  indexAgentCalls,
  resolveParent,
  type SubagentMeta,
  spawnedEvent,
} from "../transcript/subagents";
import type {
  SdkConversationMessage,
  SdkMessageLike,
  SdkResultMessage,
  SdkSystemMessage,
} from "./messages";

// Maps the Agent SDK's stream of one session to Gravita events. Conversation messages are
// wrapped as transcript records and go through `normalizeRecords`, so a fact read from the
// SDK and the same fact read later from the transcript carry the same key and are stored
// once. Task messages become the same agent facts the transcript's subagent files produce.

export interface SdkMapperOptions {
  projectId: string;
  sessionId: string;
  /** Timestamp for messages that carry none (system and result messages). */
  now: () => string;
  /** Transcript file an agent writes, for `outputRef` pointers. Without it they are left out. */
  transcriptPath?: (agentId: string) => string | undefined;
}

/** Assistant errors that a retry can fix; anything else needs the user. */
const RETRYABLE_ERRORS = new Set(["rate_limit", "overloaded", "server_error"]);

const LIFECYCLE_STATUS = new Set(["pending", "running", "paused", "completed", "failed", "killed"]);

type LifecycleStatus = "pending" | "running" | "paused" | "completed" | "failed" | "killed";

/**
 * Stateful per session: it remembers which task each Agent tool call started and which
 * agent issued each Agent call, to attribute subagent messages and resolve parents.
 */
export class SdkSessionMapper {
  /** Agent/Task tool_use id → the subagent (task id) it started. */
  private readonly taskByToolUse = new Map<string, string>();
  /** Agent/Task tool_use id → agent that issued it (for parent resolution). */
  private readonly calls = new Map<string, string>();
  /** Task ids that are subagents (not background shells or workflows). */
  private readonly agentTasks = new Set<string>();

  constructor(private readonly o: SdkMapperOptions) {}

  map(raw: unknown): GravitaEvent[] {
    if (!raw || typeof raw !== "object") return [];
    const m = raw as SdkMessageLike;
    switch (m.type) {
      case "assistant":
      case "user":
        return this.conversation(m);
      case "system":
        return this.system(m);
      case "result":
        return this.result(m);
      default:
        return [];
    }
  }

  /** The agent that wrote a message: its agent_id, else the task its parent tool call started. */
  agentOf(m: Pick<SdkConversationMessage, "agent_id" | "parent_tool_use_id">): string {
    if (typeof m.agent_id === "string" && m.agent_id) return m.agent_id;
    if (m.parent_tool_use_id) return this.taskByToolUse.get(m.parent_tool_use_id) ?? MAIN_AGENT;
    return MAIN_AGENT;
  }

  private conversation(m: SdkConversationMessage): GravitaEvent[] {
    const agentId = this.agentOf(m);
    const ts = m.timestamp ?? this.o.now();
    const record: RawRecord = {
      type: m.type,
      timestamp: ts,
      ...(m.uuid ? { uuid: m.uuid } : {}),
      ...(m.message ? { message: m.message } : {}),
      ...(m.tool_use_result !== undefined ? { toolUseResult: m.tool_use_result } : {}),
      ...(m.isSynthetic ? { isMeta: true } : {}),
    };
    if (m.type === "assistant") indexAgentCalls([record], agentId, this.calls);
    const path = this.o.transcriptPath?.(agentId);
    const out = normalizeRecords([record], {
      projectId: this.o.projectId,
      sessionId: this.o.sessionId,
      agentId,
      filePath: path ?? "",
    }).map((e) => fromSdk(e, path === undefined));
    if (m.type === "assistant" && m.error) out.push(this.assistantError(m, agentId, ts));
    return out;
  }

  private assistantError(m: SdkConversationMessage, agentId: string, ts: string): GravitaEvent {
    const auth = m.error === "authentication_failed";
    const content = m.message?.content;
    const text = Array.isArray(content)
      ? content
          .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
          .join(" ")
          .trim()
      : typeof content === "string"
        ? content.trim()
        : "";
    return {
      ...this.base(ts, agentId),
      key: `error:${m.uuid ?? `${this.o.sessionId}:${m.error}:${ts}`}`,
      type: "error",
      data: {
        kind: auth ? "auth" : String(m.error),
        message: text
          ? preview(text)
          : auth
            ? "Claude Code is not logged in"
            : "Claude Code reported an error",
        retryable: RETRYABLE_ERRORS.has(String(m.error)),
      },
    };
  }

  private system(m: SdkSystemMessage): GravitaEvent[] {
    const ts = m.timestamp ?? this.o.now();
    const sid = this.o.sessionId;
    switch (m.subtype) {
      case "task_started": {
        const taskId = m.task_id;
        if (!taskId || !isAgentTask(m)) return [];
        this.agentTasks.add(taskId);
        if (m.tool_use_id) this.taskByToolUse.set(m.tool_use_id, taskId);
        const meta: SubagentMeta = {};
        if (m.subagent_type) meta.agentType = m.subagent_type;
        if (m.description) meta.description = m.description;
        if (m.tool_use_id) meta.toolUseId = m.tool_use_id;
        if (typeof m.spawn_depth === "number") meta.spawnDepth = m.spawn_depth;
        // An unknown parent task (a workflow, a teammate) means "no parent" per the SDK.
        if (m.parent_task_id && this.agentTasks.has(m.parent_task_id))
          meta.parentAgentId = m.parent_task_id;
        if (m.is_backgrounded) meta.requestShape = "background";
        const ctx = { projectId: this.o.projectId, sessionId: sid, agentId: taskId };
        return [fromSdk(spawnedEvent(ctx, meta, resolveParent(meta, this.calls), ts), false)];
      }
      case "task_progress": {
        const taskId = m.task_id;
        if (!taskId || !this.isAgent(taskId)) return [];
        const u = m.usage;
        const tag = m.uuid ?? `${u?.total_tokens ?? 0}:${u?.tool_uses ?? 0}`;
        return [
          {
            ...this.base(ts, taskId),
            key: `agent:${sid}:${taskId}:progress:${tag}`,
            type: "agent.progress",
            data: {
              ...(m.summary ? { summary: preview(m.summary) } : {}),
              ...(m.last_tool_name ? { lastToolName: m.last_tool_name } : {}),
              ...(typeof u?.total_tokens === "number" ? { totalTokens: u.total_tokens } : {}),
              ...(typeof u?.tool_uses === "number" ? { toolUses: u.tool_uses } : {}),
            },
          },
        ];
      }
      case "task_updated": {
        const taskId = m.task_id;
        const status = m.patch?.status;
        if (!taskId || !this.isAgent(taskId) || !status || !LIFECYCLE_STATUS.has(status)) return [];
        return [
          {
            ...this.base(ts, taskId),
            key: keys.agentLifecycle(sid, taskId, status),
            type: "agent.lifecycle",
            data: { status: status as LifecycleStatus },
          },
        ];
      }
      case "task_notification": {
        const taskId = m.task_id;
        if (!taskId || !this.isAgent(taskId)) return [];
        const status =
          m.status === "completed" ? "completed" : m.status === "stopped" ? "stopped" : "failed";
        const u = m.usage;
        return [
          {
            ...this.base(ts, taskId),
            key: keys.agentCompleted(sid, taskId),
            type: "agent.completed",
            data: {
              status,
              ...(m.summary ? { summary: preview(m.summary) } : {}),
              ...(typeof u?.total_tokens === "number" ? { totalTokens: u.total_tokens } : {}),
              ...(typeof u?.tool_uses === "number" ? { toolUseCount: u.tool_uses } : {}),
              ...(typeof u?.duration_ms === "number" ? { durationMs: u.duration_ms } : {}),
            },
          },
        ];
      }
      case "compact_boundary": {
        if (!m.uuid) return [];
        const meta = m.compact_metadata;
        return [
          {
            ...this.base(ts, MAIN_AGENT),
            key: `compact:${m.uuid}`,
            type: "compact.happened",
            data: {
              ...(meta?.trigger ? { trigger: meta.trigger } : {}),
              ...(meta?.pre_tokens ? { preTokens: meta.pre_tokens } : {}),
            },
          },
        ];
      }
      default:
        return [];
    }
  }

  private result(m: SdkResultMessage): GravitaEvent[] {
    const ts = this.o.now();
    const sid = this.o.sessionId;
    const out: GravitaEvent[] = [];
    if (m.uuid) {
      out.push({
        ...this.base(ts, MAIN_AGENT),
        key: keys.turnCompleted(sid, m.uuid),
        type: "turn.completed",
        data: {
          ...(m.subtype ? { subtype: m.subtype } : {}),
          ...(typeof m.duration_ms === "number" ? { durationMs: m.duration_ms } : {}),
          ...(typeof m.num_turns === "number" ? { numTurns: m.num_turns } : {}),
        },
      });
    }
    // Same key as the transcript's cost-state record, so the total is never counted twice.
    if (typeof m.total_cost_usd === "number") {
      out.push({
        ...this.base(ts, MAIN_AGENT),
        key: `cost:${sid}:${m.total_cost_usd}`,
        type: "cost.snapshot",
        data: { totalCostUsd: m.total_cost_usd },
      });
    }
    return out;
  }

  private isAgent(taskId: string): boolean {
    return this.agentTasks.has(taskId) || AGENT_ID.test(taskId);
  }

  private base(ts: string, agentId: string) {
    return {
      ts,
      source: "sdk" as const,
      provider: "claude" as const,
      projectId: this.o.projectId,
      sessionId: this.o.sessionId,
      agentId,
    };
  }
}

/** A subagent task: `local_agent`, or (older CLIs without task_type) one with a subagent id. */
function isAgentTask(m: SdkSystemMessage): boolean {
  if (m.task_type !== undefined) return m.task_type === "local_agent";
  return Boolean(m.subagent_type) || AGENT_ID.test(m.task_id ?? "");
}

/** Marks an event as read from the SDK; drops `outputRef` when the transcript path is unknown. */
function fromSdk(e: GravitaEvent, dropOutputRef: boolean): GravitaEvent {
  if (dropOutputRef && e.type === "tool.completed" && e.data.outputRef) {
    const { outputRef: _ref, ...data } = e.data;
    return { ...e, source: "sdk", data };
  }
  return { ...e, source: "sdk" };
}
