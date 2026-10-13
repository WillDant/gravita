import type { AgentProvider, Provider } from "@gravita/protocol";

/** How many sessions Gravita runs at once (each is a `claude` process on the user's account). */
export const MAX_CHAT_SESSIONS = 6;

/** Squad sessions have their own caps (see squad-policy); only the rest count as chats. */
export function countChats(runtimes: readonly { kind?: string }[]): number {
  return runtimes.filter((r) => r.kind !== "squad").length;
}

/** Whether one more session may start while `running` are alive. */
export function canStartChat(running: number, limit = MAX_CHAT_SESSIONS): boolean {
  return running < limit;
}

/** Whose session modes a runtime speaks: the scripted demo plays Claude Code. */
export function modesOf(provider: Provider): AgentProvider {
  return provider === "codex" ? "codex" : "claude";
}
