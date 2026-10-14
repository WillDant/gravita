import type { ConversationMessage, GravitaEvent } from "@gravita/protocol";
import type { Slice } from "../store";

/** Live events wait this long for company before the conversation is fetched again. */
export const CONVERSATION_REFRESH_MS = 350;

const REFRESH_ON: ReadonlySet<GravitaEvent["type"]> = new Set([
  "message.user",
  "message.assistant",
  "turn.completed",
]);

export interface ConversationView {
  sessionId: string;
  messages: ConversationMessage[];
  status: "loading" | "ready" | "failed";
}

/** A message the user just sent, shown until the transcript brings it back. */
export interface PendingMessage {
  sessionId: string;
  text: string;
  /** When it was sent (ISO), to match it against the transcript's copy. */
  ts: string;
}

export interface ConversationSlice {
  /** Full text of the open session's messages, while the Conversation lens shows it. */
  conversation?: ConversationView;
  pendingMessage?: PendingMessage;
  setPendingMessage: (pending: PendingMessage | undefined) => void;
  openConversation: (sessionId: string) => void;
  closeConversation: (sessionId: string) => void;
  /** Fetches the open conversation again, keeping what's shown meanwhile. */
  refreshConversation: () => void;
  /** Schedules a refresh when live events bring new messages to the open conversation. */
  noteConversationEvents: (events: readonly GravitaEvent[]) => void;
}

/** One entry per message uuid, in first-seen order, with the latest content. */
export function dedupeMessages(messages: readonly ConversationMessage[]): ConversationMessage[] {
  const byUuid = new Map<string, ConversationMessage>();
  for (const m of messages) byUuid.set(m.uuid, m);
  return [...byUuid.values()];
}

/** Clock skew between the UI and the transcript that still counts as "the same send". */
const PENDING_SKEW_MS = 5_000;

/** Whether the transcript already carries the message the user sent. */
export function hasArrived(
  messages: readonly ConversationMessage[],
  pending: PendingMessage,
): boolean {
  const sent = Date.parse(pending.ts) - PENDING_SKEW_MS;
  const text = pending.text.trim();
  return messages.some(
    (m) => m.role === "user" && m.text.trim() === text && Date.parse(m.ts) >= sent,
  );
}

export const createConversationSlice: Slice<ConversationSlice> = (gateway) => (set, get) => {
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fetch = (sessionId: string) => {
    const mine = ++request;
    gateway.conversation({ sessionId }).then(
      ({ messages }) => {
        if (mine !== request || get().conversation?.sessionId !== sessionId) return;
        const deduped = dedupeMessages(messages);
        const pending = get().pendingMessage;
        const arrived = pending?.sessionId === sessionId && hasArrived(deduped, pending);
        set({
          conversation: { sessionId, messages: deduped, status: "ready" },
          ...(arrived ? { pendingMessage: undefined } : {}),
        });
      },
      () => {
        const cur = get().conversation;
        if (mine !== request || cur?.sessionId !== sessionId) return;
        // Keep what was already shown; only an empty view turns into the failure state.
        if (cur.messages.length === 0) set({ conversation: { ...cur, status: "failed" } });
      },
    );
  };

  return {
    setPendingMessage: (pendingMessage) => set({ pendingMessage }),
    openConversation: (sessionId) => {
      const cur = get().conversation;
      if (cur?.sessionId === sessionId && cur.status !== "failed") return;
      set({ conversation: { sessionId, messages: [], status: "loading" } });
      fetch(sessionId);
    },
    closeConversation: (sessionId) => {
      if (get().conversation?.sessionId !== sessionId) return;
      clearTimeout(timer);
      request++;
      set({ conversation: undefined });
    },
    refreshConversation: () => {
      const cur = get().conversation;
      if (cur) fetch(cur.sessionId);
    },
    noteConversationEvents: (events) => {
      const cur = get().conversation;
      if (!cur) return;
      const relevant = events.some((e) => e.sessionId === cur.sessionId && REFRESH_ON.has(e.type));
      if (!relevant) return;
      clearTimeout(timer);
      timer = setTimeout(() => get().refreshConversation(), CONVERSATION_REFRESH_MS);
    },
  };
};
