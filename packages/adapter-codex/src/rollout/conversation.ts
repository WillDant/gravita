import type { ConversationMessage } from "@gravita/protocol";
import { codexCallId, codexItemId } from "../ids";
import { SPAWN_AGENT } from "../tools";
import { isObject, type RolloutLine, str, textParts, typedText } from "./records";

// The root thread's conversation with full text, for the Conversation lens. Events carry
// previews only; this reads the rollout itself (read-only) when the user opens a session.

function spawnAgentType(raw: unknown): string {
  let args: unknown = raw;
  if (typeof raw === "string") {
    try {
      args = JSON.parse(raw);
    } catch {
      args = {};
    }
  }
  const o = isObject(args) ? args : {};
  return str(o, "agent_type") ?? str(o, "agent_role") ?? str(o, "role") ?? "default";
}

/**
 * User prompts and assistant replies of one thread, in order: injected context and
 * Codex's own instructions are left out, and spawn_agent calls become `spawned` chips on the
 * assistant message they follow. `threadId` names the messages like the events do.
 */
export function codexConversationOf(
  lines: readonly RolloutLine[],
  threadId: string,
): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  let n = 0;
  for (const r of lines) {
    if (r.type !== "response_item") continue;
    const p = r.payload;
    const ts = r.timestamp ?? "";
    n++;
    if (p.type === "message") {
      const role = str(p, "role");
      if (role === "user") {
        const text = typedText(p.content);
        if (text)
          out.push({ uuid: codexItemId(threadId, str(p, "id") ?? `u${n}`), role, ts, text });
      } else if (role === "assistant") {
        const text = textParts(p.content).join("\n\n").trim();
        if (!text) continue;
        const last = out.at(-1);
        // Codex streams one reply as several messages (commentary, then the final answer).
        if (last?.role === "assistant" && !last.spawned) last.text = `${last.text}\n\n${text}`;
        else out.push({ uuid: codexItemId(threadId, str(p, "id") ?? `m${n}`), role, ts, text });
      }
      continue;
    }
    if (p.type === "function_call" && str(p, "name") === SPAWN_AGENT) {
      const callId = str(p, "call_id");
      if (!callId) continue;
      let last = out.at(-1);
      if (last?.role !== "assistant") {
        last = { uuid: codexItemId(threadId, `s${n}`), role: "assistant", ts, text: "" };
        out.push(last);
      }
      last.spawned ??= [];
      const toolUseId = codexCallId(callId);
      if (!last.spawned.some((s) => s.toolUseId === toolUseId))
        last.spawned.push({ toolUseId, agentType: spawnAgentType(p.arguments) });
    }
  }
  return out;
}
