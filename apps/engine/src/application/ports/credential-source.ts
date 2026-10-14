import type { ProviderCredential } from "@gravita/protocol";

/**
 * The one credential Gravita holds: the Cursor API key the user pasted in its settings
 * (ADR 008). The desktop shell keeps it in the Keychain and hands it to the engine at start
 * and on every change; the engine keeps it in memory only. Its value is never logged, never
 * stored, and never leaves the engine except as `CURSOR_API_KEY` in the environment of the
 * `cursor-agent` processes Gravita starts.
 */
export interface CredentialSource {
  /** The Cursor API key, or undefined when none is configured. */
  cursorKey(): string | undefined;
  /** Called after the key was set, replaced or removed; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
}

/** What checking a key with Cursor says of it (`unchecked`: Cursor couldn't be reached). */
export type CursorKeyCheck = Extract<ProviderCredential, { source: "app" }>["state"];

/** Checks a Cursor API key without opening a session (`cursor-agent models`). */
export interface CursorKeyValidator {
  validate(key: string): Promise<CursorKeyCheck>;
}
