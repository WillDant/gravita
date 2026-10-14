// Cursor ids as Gravita names them. Every id a Cursor event carries gets a "cursor:" prefix,
// so it can never collide with a Claude or Codex id in the shared idempotency keys and
// projections. ACP's tool call ids are only unique within a session, so a call's id also
// names its session.

export const CURSOR_PREFIX = "cursor:";

const ns = (id: string) => (id.startsWith(CURSOR_PREFIX) ? id : `${CURSOR_PREFIX}${id}`);

/** A Gravita session is one ACP session, named after it. */
export const cursorSessionId = (acpSessionId: string): string => ns(acpSessionId);

/** One tool call of one ACP session. */
export const cursorCallId = (acpSessionId: string, toolCallId: string): string =>
  `${CURSOR_PREFIX}${acpSessionId}:${toolCallId}`;

/**
 * One assistant block (a message or a thought) of a turn: the turn is named by the id
 * Gravita gave its user message, the block by its place in the turn.
 */
export const cursorMessageId = (acpSessionId: string, turnId: string, block: number): string =>
  `${CURSOR_PREFIX}${acpSessionId}:${turnId}:${block}`;

/** The ACP session id inside a Gravita session id, or undefined when it isn't Cursor's. */
export function acpSessionIdOf(id: string): string | undefined {
  return id.startsWith(CURSOR_PREFIX) ? id.slice(CURSOR_PREFIX.length) : undefined;
}
