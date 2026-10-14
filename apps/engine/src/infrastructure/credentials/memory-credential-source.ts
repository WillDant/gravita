import type { CredentialSource } from "../../application/ports/credential-source";

/**
 * The Cursor API key in the engine's memory, as the desktop shell last handed it over
 * (stdin). Nothing here writes it anywhere or prints it.
 */
export class MemoryCredentialSource implements CredentialSource {
  private key: string | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(key?: string) {
    this.key = normalize(key);
  }

  cursorKey(): string | undefined {
    return this.key;
  }

  /** A new key, or none (`null`/empty: removed). Listeners hear only an actual change. */
  setCursorKey(value: string | null | undefined) {
    const next = normalize(value);
    if (next === this.key) return;
    this.key = next;
    for (const l of this.listeners) l();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Never the key: `String(source)` or a log of it says only whether there is one. */
  toString(): string {
    return `MemoryCredentialSource(${this.key ? "cursor key set" : "no key"})`;
  }

  toJSON(): string {
    return this.toString();
  }
}

function normalize(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/**
 * One line of the engine's stdin after the token: `{"type":"cursorKey","value":"…"|null}`
 * sets or removes the Cursor key; anything else (heartbeats, unknown messages) is ignored.
 * Returns whether the line was a key message. The line is never logged.
 */
export function applyBootstrapLine(line: string, credentials: MemoryCredentialSource): boolean {
  const text = line.trim();
  if (!text.startsWith("{")) return false;
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return false;
  }
  if (!msg || typeof msg !== "object") return false;
  const { type, value } = msg as { type?: unknown; value?: unknown };
  if (type !== "cursorKey") return false;
  if (value !== null && typeof value !== "string") return false;
  credentials.setCursorKey(value);
  return true;
}
