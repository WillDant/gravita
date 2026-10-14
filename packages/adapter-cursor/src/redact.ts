/** What a masked secret reads as in events. */
export const MASK = "••••";

/**
 * A function that replaces every occurrence of `secret` in a text with `MASK` (unchanged
 * when there is no secret). For the mapper's `redact`: the Cursor API key must never reach
 * an event, whatever the agent prints.
 */
export function maskSecret(secret: string | undefined): (text: string) => string {
  const s = secret?.trim();
  if (!s) return (text) => text;
  return (text) => (text.includes(s) ? text.split(s).join(MASK) : text);
}
