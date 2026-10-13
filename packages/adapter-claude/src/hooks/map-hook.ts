import { createHash } from "node:crypto";
import { type GravitaEvent, keys, MAIN_AGENT } from "@gravita/protocol";
import { inputPreview } from "../tools";
import { normalizeRecords } from "../transcript/normalize";
import type { RawRecord } from "../transcript/records";
import type { HookPayload } from "./payload";

// Maps one Claude Code hook to Gravita events plus a signal about the agent's permission
// prompts. Pure: the prompt bookkeeping (which prompt is open, what resolves it) lives in
// the engine. Tool facts are wrapped as transcript records and go through
// `normalizeRecords`, so a hook and the transcript line for the same tool call carry the
// same key and data and are stored once (whichever arrives first).

export interface HookContext {
  projectId: string;
  /** When Gravita received the hook (ISO 8601); hooks carry no timestamp of their own. */
  ts: string;
}

/** One tool call, as the engine tracks it to tie a prompt to the call that raised it. */
export interface HookToolCall {
  toolUseId: string;
  toolName: string;
  /** Hash of the tool name and its input: tells a prompt which call it belongs to. */
  inputKey: string;
  inputPreview: string;
}

export type HookSignal =
  /** PreToolUse: a call started (any prompt of another call that was showing is over). */
  | { kind: "tool-start"; call: HookToolCall }
  /** PostToolUse / PostToolUseFailure: a call ended. */
  | { kind: "tool-end"; toolUseId: string; inputKey: string | undefined; ok: boolean }
  /**
   * A permission dialog is showing. PermissionRequest names the tool; Notification
   * (`permission_prompt`) doesn't, so the engine ties it to the agent's open call.
   */
  | {
      kind: "prompt";
      via: "request" | "notification";
      toolName?: string;
      inputKey?: string;
      inputPreview?: string;
    }
  /** Stop, SubagentStop, UserPromptSubmit: this agent's prompts are over. */
  | { kind: "turn-end" }
  /** SessionEnd: every prompt of the session is over. */
  | { kind: "session-end" };

export interface HookMapping {
  sessionId: string;
  /** "main", or the subagent the hook fired in. */
  agentId: string;
  events: GravitaEvent[];
  signal?: HookSignal;
}

/** Key of the hook's own `session.started` (see `mapHook`). */
export const hookSessionStartedKey = (sessionId: string) =>
  `${keys.sessionStarted(sessionId)}:hook`;

/** JSON with object keys sorted, so equal inputs always hash the same. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function inputKeyOf(toolName: string, input: Record<string, unknown>): string {
  return createHash("sha1")
    .update(`${toolName}\0${stableJson(input)}`)
    .digest("hex")
    .slice(0, 16);
}

export function hookAgentId(p: Pick<HookPayload, "agent_id">): string {
  return p.agent_id ?? MAIN_AGENT;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Text of a tool's response, for the result preview (the transcript's tool_result text). */
function responseText(response: unknown): string | undefined {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return undefined;
  const r = response as Record<string, unknown>;
  const out = [str(r.stdout), str(r.stderr)].filter(Boolean).join("\n");
  if (out) return out;
  const file = r.file && typeof r.file === "object" ? (r.file as Record<string, unknown>) : {};
  return str(r.content) ?? str(r.output) ?? str(r.result) ?? str(r.message) ?? str(file.content);
}

function errorText(error: unknown): string {
  return typeof error === "string" && error ? error : "The tool failed";
}

export function mapHook(p: HookPayload, ctx: HookContext): HookMapping {
  const sessionId = p.session_id;
  const agentId = hookAgentId(p);
  const out: HookMapping = { sessionId, agentId, events: [] };
  const viaTranscript = (record: RawRecord) =>
    normalizeRecords([{ ...record, timestamp: ctx.ts }], {
      projectId: ctx.projectId,
      sessionId,
      agentId,
      // No record uuid, so no outputRef pointer: the hook can't say where the line lives.
      filePath: "",
    }).map((e): GravitaEvent => ({ ...e, source: "hook" }));

  switch (p.hook_event_name) {
    case "SessionStart": {
      // A resumed or compacted session already started; /clear starts a new one.
      if (p.source === "resume" || p.source === "compact" || !p.cwd) return out;
      // Its own key, not the transcript's: the hook arrives first (the transcript file only
      // appears with the first prompt) but lacks the branch and CLI version the transcript
      // line carries, so both are kept and applied.
      out.events.push({
        key: hookSessionStartedKey(sessionId),
        ts: ctx.ts,
        source: "hook",
        provider: "claude",
        projectId: ctx.projectId,
        sessionId,
        agentId: MAIN_AGENT,
        type: "session.started",
        data: { kind: "external", cwd: p.cwd },
      });
      return out;
    }

    case "PreToolUse": {
      if (!p.tool_name || !p.tool_use_id) return out;
      const input = p.tool_input ?? {};
      out.events = viaTranscript({
        type: "assistant",
        message: {
          // Keys of tool facts don't depend on the message id; this one is never stored.
          id: `hook:${p.tool_use_id}`,
          content: [{ type: "tool_use", id: p.tool_use_id, name: p.tool_name, input }],
        },
      });
      out.signal = {
        kind: "tool-start",
        call: {
          toolUseId: p.tool_use_id,
          toolName: p.tool_name,
          inputKey: inputKeyOf(p.tool_name, input),
          inputPreview: inputPreview(input),
        },
      };
      return out;
    }

    case "PostToolUse":
    case "PostToolUseFailure": {
      if (!p.tool_use_id) return out;
      const ok = p.hook_event_name === "PostToolUse";
      const text = ok ? responseText(p.tool_response) : errorText(p.error);
      out.events = viaTranscript({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: p.tool_use_id,
              ...(text ? { content: text } : {}),
              ...(ok ? {} : { is_error: true }),
            },
          ],
        },
        // The same object the transcript records as toolUseResult (file changes, agent totals).
        ...(ok && p.tool_response !== undefined ? { toolUseResult: p.tool_response } : {}),
      });
      out.signal = {
        kind: "tool-end",
        toolUseId: p.tool_use_id,
        inputKey: p.tool_name ? inputKeyOf(p.tool_name, p.tool_input ?? {}) : undefined,
        ok,
      };
      return out;
    }

    case "PermissionRequest": {
      if (!p.tool_name) return out;
      const input = p.tool_input ?? {};
      out.signal = {
        kind: "prompt",
        via: "request",
        toolName: p.tool_name,
        inputKey: inputKeyOf(p.tool_name, input),
        inputPreview: inputPreview(input),
      };
      return out;
    }

    case "Notification":
      if (p.notification_type === "permission_prompt")
        out.signal = { kind: "prompt", via: "notification" };
      return out;

    case "SubagentStop":
      // Without the subagent's id it would end the main agent's prompts.
      if (p.agent_id) out.signal = { kind: "turn-end" };
      return out;

    case "Stop":
    case "UserPromptSubmit":
      // Only a signal: the prompt text is never read (the transcript has it).
      out.signal = { kind: "turn-end" };
      return out;

    case "SessionEnd":
      out.signal = { kind: "session-end" };
      return out;
  }
}
