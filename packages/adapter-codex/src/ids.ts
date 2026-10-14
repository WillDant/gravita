// Codex ids as Gravita names them. Every id a Codex event carries (sessions, subagents,
// tool calls, messages) gets a "codex:" prefix, so it can never collide with a Claude id in
// the shared idempotency keys and projections. The rollout reader and the app-server mapper
// both derive ids here, so the same fact from either source gets the same key.

export const CODEX_PREFIX = "codex:";

const ns = (id: string) => (id.startsWith(CODEX_PREFIX) ? id : `${CODEX_PREFIX}${id}`);

/** A Gravita session is a Codex thread tree, named after its root thread. */
export const codexSessionId = (rootThreadId: string): string => ns(rootThreadId.toLowerCase());

/** A subagent is its own thread. */
export const codexAgentId = (threadId: string): string => ns(threadId.toLowerCase());

export const codexCallId = (callId: string): string => ns(callId);

/** A response item (message, reasoning) of one thread. */
export const codexItemId = (threadId: string, itemId: string): string =>
  `${CODEX_PREFIX}${threadId.toLowerCase()}:${itemId}`;

/** The thread id inside a Gravita session or agent id, or undefined when it isn't Codex's. */
export function threadIdOf(id: string): string | undefined {
  return id.startsWith(CODEX_PREFIX) ? id.slice(CODEX_PREFIX.length) : undefined;
}
