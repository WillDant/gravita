import type { ConversationMessage } from "@gravita/protocol";
import { isAgentTool } from "../tools";
import { isCommandEcho, stripInjected } from "./normalize";
import { type ContentBlock, parseTaskNotification, type RawRecord } from "./records";

// The main agent's conversation with full text, for the Conversation lens. Events carry
// previews only; this reads the transcript itself (read-only) when the user opens a session.

function fullText(content: string | ContentBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n\n");
}

/**
 * User prompts and assistant replies of the main agent, in order. Assistant records of one
 * message (one record per content block) are joined into one message. Tool results, meta
 * and command echoes, task notifications and compaction summaries are left out; Agent/Task
 * calls become `spawned` chips on the message that made them.
 */
export function conversationOf(records: readonly RawRecord[]): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  const assistant = new Map<string, ConversationMessage>();

  for (const r of records) {
    if (r.isSidechain) continue;
    if (r.type === "user") {
      const content = r.message?.content;
      if (!r.uuid || r.isMeta || r.isCompactSummary) continue;
      if (Array.isArray(content) && content.some((b) => b.type === "tool_result")) continue;
      const raw = fullText(content);
      if (parseTaskNotification(raw)) continue;
      const text = stripInjected(raw);
      if (!text || isCommandEcho(text)) continue;
      out.push({ uuid: r.uuid, role: "user", ts: r.timestamp ?? "", text });
      continue;
    }
    if (r.type !== "assistant") continue;
    const msg = r.message;
    const id = msg?.id ?? r.uuid;
    if (!msg || !id || !Array.isArray(msg.content)) continue;
    const entry = (): ConversationMessage => {
      let m = assistant.get(id);
      if (!m) {
        m = { uuid: r.uuid ?? id, role: "assistant", ts: r.timestamp ?? "", text: "" };
        assistant.set(id, m);
        out.push(m);
      }
      return m;
    };
    for (const b of msg.content) {
      if (b.type === "text" && b.text?.trim()) {
        const m = entry();
        m.text = m.text ? `${m.text}\n\n${b.text}` : b.text;
      } else if (b.type === "tool_use" && b.id && b.name && isAgentTool(b.name)) {
        const agentType = b.input?.subagent_type;
        const m = entry();
        m.spawned ??= [];
        if (!m.spawned.some((s) => s.toolUseId === b.id)) {
          m.spawned.push({
            toolUseId: b.id,
            agentType: typeof agentType === "string" ? agentType : "general-purpose",
          });
        }
      }
    }
  }
  return out;
}
