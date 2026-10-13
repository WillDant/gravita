import { createHash } from "node:crypto";
import { type GravitaEvent, keys, MAIN_AGENT } from "@gravita/protocol";
import { inputPreview, preview, toolKind, toolTarget } from "../tools";
import { AGENT_ID, type ContentBlock, parseTaskNotification, type RawRecord } from "./records";

export interface FileContext {
  projectId: string;
  /** The main session id (subagent records carry their parent's session id too). */
  sessionId: string;
  /** "main" for the session file, the subagent id for subagents/agent-<id>.jsonl. */
  agentId: string;
  /** Absolute path of the JSONL file, used for outputRef pointers. */
  filePath: string;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/** Slash commands and their output are recorded as user turns; they aren't human prompts. */
export function isCommandEcho(text: string): boolean {
  return /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/.test(
    text,
  );
}

/**
 * Removes the context blocks Claude Code and hosts inject into user turns
 * (`<system-reminder>…</system-reminder>`), leaving only what the person typed.
 */
export function stripInjected(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, "").trim();
}

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String(b.text ?? "") : ""))
      .join(" ");
  }
  return "";
}

interface PatchHunk {
  lines?: string[];
}

function fileChangesOf(result: unknown): { path: string; added: number; removed: number }[] {
  if (!result || typeof result !== "object") return [];
  const r = result as {
    filePath?: unknown;
    structuredPatch?: unknown;
    content?: unknown;
    type?: unknown;
  };
  if (typeof r.filePath !== "string") return [];
  let added = 0;
  let removed = 0;
  if (Array.isArray(r.structuredPatch)) {
    for (const hunk of r.structuredPatch as PatchHunk[]) {
      for (const line of hunk.lines ?? []) {
        if (line.startsWith("+")) added++;
        else if (line.startsWith("-")) removed++;
      }
    }
  } else if (r.type === "create" && typeof r.content === "string") {
    added = r.content.split("\n").length;
  }
  return [{ path: r.filePath, added, removed }];
}

/**
 * Maps the records of ONE transcript file to Gravita events. Pure and deterministic:
 * the same records always produce the same events with the same keys, so re-reading
 * a file (or reading it from another source) never duplicates anything.
 */
export function normalizeRecords(records: RawRecord[], ctx: FileContext): GravitaEvent[] {
  const out: GravitaEvent[] = [];
  const isMain = ctx.agentId === MAIN_AGENT;
  const base = (ts: string | undefined, agentId: string = ctx.agentId) => ({
    ts: ts ?? "",
    source: "transcript" as const,
    provider: "claude" as const,
    projectId: ctx.projectId,
    sessionId: ctx.sessionId,
    agentId,
  });
  let sessionStarted = false;

  for (const r of records) {
    if (isMain && !sessionStarted && r.cwd) {
      sessionStarted = true;
      out.push({
        ...base(r.timestamp),
        key: keys.sessionStarted(ctx.sessionId),
        type: "session.started",
        data: {
          kind: "external",
          cwd: r.cwd,
          ...(r.gitBranch ? { gitBranch: r.gitBranch } : {}),
          ...(r.entrypoint ? { entrypoint: r.entrypoint } : {}),
          ...(r.version ? { cliVersion: r.version } : {}),
        },
      });
    }

    switch (r.type) {
      case "custom-title":
      case "ai-title": {
        const title = r.customTitle ?? r.aiTitle;
        if (isMain && title) {
          out.push({
            ...base(r.timestamp),
            key: `session:${ctx.sessionId}:title:${r.type}:${hash(title)}`,
            type: "session.titled",
            data: { title },
          });
        }
        break;
      }

      case "assistant": {
        const msg = r.message;
        if (!msg?.id || !Array.isArray(msg.content)) break;
        for (const block of msg.content)
          pushAssistantBlock(out, base(r.timestamp), msg.id, msg.model, block);
        // Only the main agent's end_turn ends the session's turn; a subagent's end_turn
        // is its final answer, and its completion arrives through the parent.
        if (isMain && msg.stop_reason === "end_turn" && r.uuid) {
          out.push({
            ...base(r.timestamp),
            key: keys.turnCompleted(ctx.sessionId, r.uuid),
            type: "turn.completed",
            data: {},
          });
        }
        const u = msg.usage;
        if (u) {
          const output = u.output_tokens ?? 0;
          out.push({
            ...base(r.timestamp),
            // One record per content block repeats usage with growing output_tokens;
            // the projection keeps the max per messageId.
            key: `${keys.usage(msg.id)}:${output}`,
            type: "usage.reported",
            data: {
              messageId: msg.id,
              ...(msg.model ? { model: msg.model } : {}),
              input: u.input_tokens ?? 0,
              output,
              cacheRead: u.cache_read_input_tokens ?? 0,
              cacheWrite: u.cache_creation_input_tokens ?? 0,
            },
          });
        }
        break;
      }

      case "user": {
        const content = r.message?.content;
        if (
          typeof content === "string" ||
          (Array.isArray(content) && !content.some((b) => b.type === "tool_result"))
        ) {
          const raw = typeof content === "string" ? content : blockText(content);
          if (r.uuid && raw.trim()) {
            const note = parseTaskNotification(raw);
            // A turn that was only injected context isn't something the person said.
            const typed = stripInjected(raw);
            const text = typed || raw;
            out.push({
              ...base(r.timestamp),
              key: keys.userMessage(r.uuid),
              type: "message.user",
              data: {
                uuid: r.uuid,
                textPreview: preview(text),
                origin: note
                  ? "task-notification"
                  : r.isMeta || !typed || isCommandEcho(typed)
                    ? "meta"
                    : "human",
              },
            });
            if (note) pushTaskNotification(out, base(r.timestamp), ctx.sessionId, note);
          }
          break;
        }
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block.type !== "tool_result" || !block.tool_use_id) continue;
          const text = blockText(block.content);
          const changes = fileChangesOf(r.toolUseResult);
          out.push({
            ...base(r.timestamp),
            key: keys.toolCompleted(block.tool_use_id),
            type: "tool.completed",
            data: {
              toolUseId: block.tool_use_id,
              ok: !block.is_error,
              ...(text ? { outputPreview: preview(text) } : {}),
              ...(r.uuid ? { outputRef: { path: ctx.filePath, uuid: r.uuid } } : {}),
              ...(block.is_error && text ? { error: preview(text) } : {}),
              ...(changes.length ? { fileChanges: changes } : {}),
            },
          });
          pushAgentResult(out, base(r.timestamp), ctx.sessionId, r.toolUseResult);
        }
        break;
      }

      case "queue-operation": {
        if (r.operation !== "enqueue" || typeof r.content !== "string") break;
        const note = parseTaskNotification(r.content);
        if (note) pushTaskNotification(out, base(r.timestamp), ctx.sessionId, note);
        break;
      }

      case "attachment": {
        const a = r.attachment;
        if (a?.type !== "task_status" || !a.taskId || !AGENT_ID.test(a.taskId)) break;
        const status = mapTaskStatus(a.status);
        if (!status) break;
        out.push({
          ...base(r.timestamp, a.taskId),
          key: keys.agentLifecycle(ctx.sessionId, a.taskId, status),
          type: "agent.lifecycle",
          data: { status },
        });
        break;
      }

      case "system": {
        if (r.subtype === "compact_boundary" && r.uuid) {
          out.push({
            ...base(r.timestamp),
            key: `compact:${r.uuid}`,
            type: "compact.happened",
            data: {
              ...(r.compactMetadata?.trigger ? { trigger: r.compactMetadata.trigger } : {}),
              ...(r.compactMetadata?.preTokens ? { preTokens: r.compactMetadata.preTokens } : {}),
            },
          });
        } else if (r.subtype === "api_error" && r.uuid) {
          out.push({
            ...base(r.timestamp),
            key: `error:${r.uuid}`,
            type: "error",
            data: {
              kind: "api_error",
              message: "The model API returned an error",
              retryable: true,
            },
          });
        }
        break;
      }

      case "cost-state": {
        if (isMain && typeof r.totalCostUSD === "number") {
          out.push({
            ...base(r.timestamp),
            key: `cost:${ctx.sessionId}:${r.totalCostUSD}`,
            type: "cost.snapshot",
            data: {
              totalCostUsd: r.totalCostUSD,
              ...(typeof r.linesAdded === "number" ? { linesAdded: r.linesAdded } : {}),
              ...(typeof r.linesRemoved === "number" ? { linesRemoved: r.linesRemoved } : {}),
            },
          });
        }
        break;
      }
      // Every other record type (mode, file-history-*, last-prompt, other attachments,
      // credential-bearing attachments) is deliberately ignored.
    }
  }
  return out;
}

type Base = Omit<GravitaEvent, "key" | "type" | "data">;

function pushAssistantBlock(
  out: GravitaEvent[],
  base: Base,
  messageId: string,
  model: string | undefined,
  block: ContentBlock,
) {
  if (block.type === "text" && block.text?.trim()) {
    out.push({
      ...base,
      key: keys.assistantBlock(messageId, "text", hash(block.text)),
      type: "message.assistant",
      data: { messageId, textPreview: preview(block.text), ...(model ? { model } : {}) },
    } as GravitaEvent);
  } else if (block.type === "thinking") {
    out.push({
      ...base,
      key: keys.assistantBlock(messageId, "thinking", hash(block.thinking ?? "")),
      type: "thinking",
      data: { messageId },
    } as GravitaEvent);
  } else if (block.type === "tool_use" && block.id && block.name) {
    const input = block.input ?? {};
    out.push({
      ...base,
      key: keys.toolStarted(block.id),
      type: "tool.started",
      data: {
        toolUseId: block.id,
        name: block.name,
        kind: toolKind(block.name),
        target: toolTarget(input),
        inputPreview: inputPreview(input),
      },
    } as GravitaEvent);
    if (block.name === "TodoWrite" && Array.isArray(input.todos)) {
      const items = (input.todos as { content?: unknown; status?: unknown }[]).map((t) => ({
        content: String(t.content ?? ""),
        status: String(t.status ?? ""),
      }));
      out.push({
        ...base,
        key: `todo:${block.id}`,
        type: "todo.updated",
        data: { items },
      } as GravitaEvent);
    }
  }
}

function pushAgentResult(out: GravitaEvent[], base: Base, sessionId: string, result: unknown) {
  if (!result || typeof result !== "object") return;
  const r = result as {
    agentId?: unknown;
    status?: unknown;
    isAsync?: unknown;
    totalTokens?: unknown;
    totalToolUseCount?: unknown;
    totalDurationMs?: unknown;
  };
  if (typeof r.agentId !== "string" || !AGENT_ID.test(r.agentId)) return;
  if (r.status === "completed" && !r.isAsync) {
    out.push({
      ...base,
      agentId: r.agentId,
      key: keys.agentCompleted(sessionId, r.agentId),
      type: "agent.completed",
      data: {
        status: "completed",
        ...(typeof r.totalTokens === "number" ? { totalTokens: r.totalTokens } : {}),
        ...(typeof r.totalToolUseCount === "number" ? { toolUseCount: r.totalToolUseCount } : {}),
        ...(typeof r.totalDurationMs === "number" ? { durationMs: r.totalDurationMs } : {}),
      },
    } as GravitaEvent);
  }
}

function pushTaskNotification(
  out: GravitaEvent[],
  base: Base,
  sessionId: string,
  note: { taskId: string; status: string; summary?: string },
) {
  if (!AGENT_ID.test(note.taskId)) return;
  const status =
    note.status === "completed" ? "completed" : note.status === "killed" ? "killed" : "failed";
  out.push({
    ...base,
    agentId: note.taskId,
    key: keys.agentCompleted(sessionId, note.taskId),
    type: "agent.completed",
    data: { status, ...(note.summary ? { summary: preview(note.summary) } : {}) },
  } as GravitaEvent);
}

function mapTaskStatus(s: string | undefined) {
  switch (s) {
    case "pending":
    case "running":
    case "paused":
    case "completed":
    case "failed":
    case "killed":
      return s;
    default:
      return undefined;
  }
}
