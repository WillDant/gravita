// JSON-RPC over a byte stream, one message per line, as `codex app-server` speaks it on
// stdio. Both sides send requests: the client asks (thread/start, turn/start…) and the
// server asks back (approvals, questions), so each side answers the other's ids. It knows
// nothing of processes: the caller hands it the incoming bytes and a way to send a line,
// which keeps it testable with in-memory streams.

export type JsonRpcId = string | number;

/** The two ends of a connection: what the peer sends us, and how we send it a line. */
export interface RpcTransport {
  /** The peer's bytes (or text), in order; it ends when the peer closes its side. */
  readonly incoming: AsyncIterable<Uint8Array | string>;
  /** Sends one message, already framed (it ends with "\n"). */
  send(line: string): void;
  /** Closes our side; the peer sees the end of its input. */
  close(): void;
}

/** An error the peer answered with (or one this side reports in its place). */
export class JsonRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

/** The connection closed before the peer answered. */
export class JsonRpcClosedError extends Error {
  constructor(readonly method: string) {
    super(`The connection closed before ${method} was answered`);
    this.name = "JsonRpcClosedError";
  }
}

/** The peer took longer than allowed to answer. */
export class JsonRpcTimeoutError extends Error {
  constructor(readonly method: string) {
    super(`${method} timed out`);
    this.name = "JsonRpcTimeoutError";
  }
}

/** JSON-RPC's own error codes. */
export const RpcCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  internalError: -32603,
} as const;

export interface JsonRpcConnectionOptions {
  /** A notification from the peer. */
  onNotification?: (method: string, params: unknown) => void;
  /**
   * A request from the peer; what it resolves with is the result, what it throws the
   * error (a `JsonRpcError` keeps its code). Without a handler every request is answered
   * "method not found", so the peer never waits forever.
   */
  onRequest?: (method: string, params: unknown, id: JsonRpcId) => Promise<unknown>;
  /** Something unreadable arrived (a malformed or oversized line, an unknown id). */
  onProtocolError?: (message: string) => void;
  /** The connection ended: the peer closed its side, or `close` was called. */
  onClose?: () => void;
  /**
   * The longest line accepted. A larger one is dropped whole (its request, if any, never
   * gets an answer from us), so a runaway peer can't grow the buffer without bound.
   */
  maxLineChars?: number;
  /** How long a request waits for its answer when the call doesn't say (default: forever). */
  requestTimeoutMs?: number;
}

/** Codex's largest messages carry a command's whole output; 16 MiB of text is plenty. */
export const MAX_LINE_CHARS = 16 * 1024 * 1024;

interface Waiting {
  method: string;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isId = (v: unknown): v is JsonRpcId =>
  typeof v === "string" || (typeof v === "number" && Number.isFinite(v));

export class JsonRpcConnection {
  private nextId = 1;
  private readonly waiting = new Map<JsonRpcId, Waiting>();
  private isClosed = false;
  private readonly maxLine: number;
  /** Resolves once the connection is closed, whichever side closed it. */
  readonly closed: Promise<void>;
  private markClosed!: () => void;

  constructor(
    private readonly transport: RpcTransport,
    private readonly o: JsonRpcConnectionOptions = {},
  ) {
    this.maxLine = o.maxLineChars ?? MAX_LINE_CHARS;
    this.closed = new Promise((resolve) => {
      this.markClosed = resolve;
    });
    void this.read();
  }

  get isOpen(): boolean {
    return !this.isClosed;
  }

  /** Asks the peer; resolves with its result, rejects with its error or when closed. */
  request(method: string, params?: unknown, opts: { timeoutMs?: number } = {}): Promise<unknown> {
    if (this.isClosed) return Promise.reject(new JsonRpcClosedError(method));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const w: Waiting = { method, resolve, reject };
      const timeoutMs = opts.timeoutMs ?? this.o.requestTimeoutMs;
      if (timeoutMs !== undefined)
        w.timer = setTimeout(() => {
          this.waiting.delete(id);
          reject(new JsonRpcTimeoutError(method));
        }, timeoutMs);
      this.waiting.set(id, w);
      this.write({ id, method, ...(params !== undefined ? { params } : {}) });
    });
  }

  /** Tells the peer something; no answer comes. */
  notify(method: string, params?: unknown) {
    if (this.isClosed) return;
    this.write({ method, ...(params !== undefined ? { params } : {}) });
  }

  /** Closes our side and rejects every request still waiting. */
  close() {
    if (this.isClosed) return;
    this.finish();
    try {
      this.transport.close();
    } catch {
      // Already closed by the peer.
    }
  }

  private write(message: Loose) {
    try {
      this.transport.send(`${JSON.stringify(message)}\n`);
    } catch (err) {
      this.o.onProtocolError?.(`sending failed: ${err instanceof Error ? err.message : err}`);
      this.finish();
    }
  }

  private async read() {
    const decoder = new TextDecoder();
    let buffer = "";
    // Inside a line that grew past the limit: skip until its end.
    let skipping = false;
    try {
      for await (const chunk of this.transport.incoming) {
        if (this.isClosed) break;
        buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (skipping) skipping = false;
          else if (line.length > this.maxLine)
            this.o.onProtocolError?.("a message exceeded the size limit");
          else this.receive(line);
          nl = buffer.indexOf("\n");
        }
        if (buffer.length > this.maxLine) {
          if (!skipping) this.o.onProtocolError?.("a message exceeded the size limit");
          skipping = true;
          buffer = "";
        }
      }
      buffer += decoder.decode();
      // A last message without its newline still counts.
      if (!skipping && buffer.trim()) this.receive(buffer);
    } catch (err) {
      this.o.onProtocolError?.(`reading failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.finish();
    }
  }

  private receive(line: string) {
    const text = line.trim();
    if (!text) return;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      this.o.onProtocolError?.("a message wasn't valid JSON");
      return;
    }
    if (!isObject(msg)) {
      this.o.onProtocolError?.("a message wasn't an object");
      return;
    }
    const { id, method } = msg;
    if (typeof method === "string") {
      if (isId(id)) void this.answer(id, method, msg.params);
      else this.o.onNotification?.(method, msg.params);
      return;
    }
    if (!isId(id)) {
      this.o.onProtocolError?.("a message had neither a method nor an id");
      return;
    }
    const w = this.waiting.get(id);
    if (!w) {
      this.o.onProtocolError?.(`an answer to an unknown request (${String(id)})`);
      return;
    }
    this.waiting.delete(id);
    clearTimeout(w.timer);
    if (isObject(msg.error)) {
      const code = typeof msg.error.code === "number" ? msg.error.code : RpcCodes.internalError;
      const message = typeof msg.error.message === "string" ? msg.error.message : "error";
      w.reject(new JsonRpcError(code, message, msg.error.data));
    } else w.resolve(msg.result);
  }

  /** Answers one of the peer's requests with the handler's result or error. */
  private async answer(id: JsonRpcId, method: string, params: unknown) {
    if (!this.o.onRequest) {
      this.write({
        id,
        error: { code: RpcCodes.methodNotFound, message: `${method} not handled` },
      });
      return;
    }
    try {
      const result = await this.o.onRequest(method, params, id);
      if (!this.isClosed) this.write({ id, result: result ?? null });
    } catch (err) {
      if (this.isClosed) return;
      const error =
        err instanceof JsonRpcError
          ? {
              code: err.code,
              message: err.message,
              ...(err.data !== undefined ? { data: err.data } : {}),
            }
          : { code: RpcCodes.internalError, message: err instanceof Error ? err.message : "error" };
      this.write({ id, error });
    }
  }

  private finish() {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const [id, w] of this.waiting) {
      clearTimeout(w.timer);
      this.waiting.delete(id);
      w.reject(new JsonRpcClosedError(w.method));
    }
    this.markClosed();
    this.o.onClose?.();
  }
}
