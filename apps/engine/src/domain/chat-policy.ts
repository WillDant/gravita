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

export const PREVIEW_CHARS = 240;

/** One-line preview of a message, like the transcript adapter's (events carry previews only). */
export function previewText(text: string, max = PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
