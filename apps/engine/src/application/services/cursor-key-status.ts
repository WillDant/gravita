import type { ProviderCredential } from "@gravita/protocol";
import type { CredentialSource, CursorKeyValidator } from "../ports/credential-source";
import type { StatusReporter } from "../ports/event-publisher";
import type { Logger } from "../ports/logger";

// The state of the Cursor API key pasted in Gravita, as Cursor's provider status carries it:
// `missing` without a key, `unchecked` until Cursor answered about it, then `valid` or
// `invalid`. A new key is checked at once; a check that finishes after the key changed again
// is dropped. Only the state is ever published, never the key.

const MISSING: ProviderCredential = { source: "none", state: "missing" };

export class CursorKeyStatus {
  private checking: Promise<ProviderCredential> | undefined;
  private checkingKey: string | undefined;

  constructor(
    private readonly d: {
      credentials: CredentialSource;
      validator: CursorKeyValidator;
      status: StatusReporter;
      logger: Logger;
    },
  ) {}

  /** What is known now, without asking Cursor. */
  current(): ProviderCredential {
    const known = this.d.status.providerStatus("cursor")?.credential;
    if (!this.d.credentials.cursorKey()) return MISSING;
    return known?.source === "app" ? known : { source: "app", state: "unchecked" };
  }

  /** Asks Cursor about the current key and publishes the answer. */
  check(): Promise<ProviderCredential> {
    const key = this.d.credentials.cursorKey();
    if (!key) {
      this.publish(MISSING);
      return Promise.resolve(MISSING);
    }
    if (this.checking && this.checkingKey === key) return this.checking;
    this.checkingKey = key;
    const run = this.d.validator
      .validate(key)
      .catch((err): "unchecked" => {
        this.d.logger.log("cursor key check failed", err instanceof Error ? err.name : "error");
        return "unchecked";
      })
      .then((state): ProviderCredential => {
        const result: ProviderCredential = { source: "app", state };
        // The key changed meanwhile: this answer is about a key that is gone.
        if (this.d.credentials.cursorKey() !== key) return this.current();
        this.publish(result);
        return result;
      })
      .finally(() => {
        if (this.checking === run) {
          this.checking = undefined;
          this.checkingKey = undefined;
        }
      });
    this.checking = run;
    return run;
  }

  /**
   * A session found out about `key` (Cursor refused it, or opened a session with it): the
   * state says so until the key changes. Ignored when the key changed meanwhile.
   */
  observed(key: string, state: "valid" | "invalid") {
    if (this.d.credentials.cursorKey() !== key) return;
    if (this.current().state === state) return;
    this.publish({ source: "app", state });
  }

  /** Publishes the state on every change of key, then checks the new one. */
  watch(): () => void {
    return this.d.credentials.onChange(() => {
      const key = this.d.credentials.cursorKey();
      this.publish(key ? { source: "app", state: "unchecked" } : MISSING);
      if (key) void this.check();
    });
  }

  private publish(credential: ProviderCredential) {
    this.d.status.updateProvider("cursor", {
      credential,
      loggedIn: credential.source === "app" && credential.state !== "invalid",
    });
  }
}
