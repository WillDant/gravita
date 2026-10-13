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

export interface ConversationSlice {
  /** Full text of the open session's messages, while the Conversation lens shows it. */
  conversation?: ConversationView;
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

export const createConversationSlice: Slice<ConversationSlice> = (gateway) => (set, get) => {
  let request = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fetch = (sessionId: string) => {
    const mine = ++request;
    gateway.conversation({ sessionId }).then(
      ({ messages }) => {
        if (mine !== request || get().conversation?.sessionId !== sessionId) return;
        set({ conversation: { sessionId, messages: dedupeMessages(messages), status: "ready" } });
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
