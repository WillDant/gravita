import { readFileSync } from "node:fs";
import type { RpcTransport } from "../app-server/json-rpc";

// A stand-in for `codex app-server` in tests: it plays a script (fixtures/codex-rpc/<version>/
// <scenario>.jsonl), checking what the client sends and sending what Codex would. Nothing
// real runs and nothing is spent. One step per line:
//
//   {"expect": {"method", "params"?}, "result"? | "error"?}  the client's next request or
//        notification must be this one (params: a subset); a request gets `result` ({}
//        when absent) or `error`.
//   {"send": {"method", "params"}}                          a notification from the server.
//   {"ask": {"id", "method", "params"}, "expectResult"?}    a server request; the script waits
//        for the client's answer and checks it (a subset).
//   {"crash": {"code"}}                                     the server dies.
//
// Requests the script doesn't expect, and that are only reads (model/list and the account
// reads), are answered from `ambient` so a test needn't script when they happen.

type Loose = Record<string, unknown>;

export interface ScriptStep {
  expect?: { method: string; params?: unknown };
  result?: unknown;
  error?: { code: number; message: string };
  send?: { method: string; params?: unknown };
  ask?: { id: string | number; method: string; params?: unknown };
  expectResult?: unknown;
  crash?: { code?: number };
}

export function loadScript(path: string): ScriptStep[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ScriptStep);
}

/** Whether `actual` has everything `expected` has (objects by key, arrays item by item). */
export function matches(expected: unknown, actual: unknown): boolean {
  if (expected === null || typeof expected !== "object") return Object.is(expected, actual);
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((e, i) => matches(e, actual[i]))
    );
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([k, v]) => matches(v, (actual as Loose)[k]));
}

export const DEFAULT_AMBIENT: Readonly<Record<string, unknown>> = {
  "model/list": {
    data: [
      {
        id: "gpt-5.5-codex",
        model: "gpt-5.5-codex",
        displayName: "GPT-5.5-Codex",
        isDefault: true,
      },
      { id: "gpt-5.5-mini", model: "gpt-5.5-mini", displayName: "GPT-5.5-Mini", isDefault: false },
    ],
    nextCursor: null,
  },
  "account/read": {
    account: { type: "chatgpt", email: null, planType: "plus" },
    requiresOpenaiAuth: true,
  },
  "account/rateLimits/read": {
    rateLimits: {
      limitId: "codex",
      primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1791900000 },
      secondary: { usedPercent: 30, windowDurationMins: 10080, resetsAt: 1792400000 },
      planType: "plus",
    },
    rateLimitsByLimitId: null,
    ordinaryUsageAllowed: true,
    rateLimitResetCredits: null,
    accountId: null,
    rateLimitUpsell: null,
  },
};

/** Text chunks for the client, with a way to end the stream. */
class Pipe implements AsyncIterable<string> {
  private readonly chunks: string[] = [];
  private waiter: (() => void) | undefined;
  private ended = false;

  push(chunk: string) {
    if (this.ended) return;
    this.chunks.push(chunk);
    this.waiter?.();
  }

  end() {
    this.ended = true;
    this.waiter?.();
  }

  async *[Symbol.asyncIterator]() {
    for (;;) {
      const next = this.chunks.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((r) => {
        this.waiter = r;
      });
      this.waiter = undefined;
    }
  }
}

export interface ScriptedAppServerOptions {
  ambient?: Readonly<Record<string, unknown>>;
  /** Split each server message across chunks this size (framing tests). */
  chunkSize?: number;
}

export class ScriptedAppServer {
  /** The client's side of the connection. */
  readonly transport: RpcTransport;
  /** Everything the client sent, parsed, in order. */
  readonly received: Loose[] = [];
  /** What went against the script. */
  readonly failures: string[] = [];
  /** The exit code: 0 once the client closed, the crash code if the script crashed. */
  readonly exited: Promise<number>;
  /** Resolves when every step has been played. */
  readonly finished: Promise<void>;
  private readonly out = new Pipe();
  private readonly inbox: Loose[] = [];
  private inboxWaiter: (() => void) | undefined;
  private exit!: (code: number) => void;
  private closed = false;
  private readonly ambient: Readonly<Record<string, unknown>>;

  constructor(
    private readonly steps: readonly ScriptStep[],
    private readonly o: ScriptedAppServerOptions = {},
  ) {
    this.ambient = o.ambient ?? DEFAULT_AMBIENT;
    this.exited = new Promise((r) => {
      this.exit = r;
    });
    this.transport = {
      incoming: this.out,
      send: (line) => this.fromClient(line),
      close: () => this.stop(0),
    };
    this.finished = this.play();
  }

  /** Requests the client sent for `method`, in order. */
  sent(method: string): Loose[] {
    return this.received.filter((m) => m.method === method);
  }

  /** Kills the server (as a signal would). */
  kill(code = 143) {
    this.stop(code);
  }

  private stop(code: number) {
    if (this.closed) return;
    this.closed = true;
    this.out.end();
    this.inboxWaiter?.();
    this.exit(code);
  }

  private toClient(msg: Loose) {
    const line = `${JSON.stringify(msg)}\n`;
    const size = this.o.chunkSize;
    if (!size) return this.out.push(line);
    for (let i = 0; i < line.length; i += size) this.out.push(line.slice(i, i + size));
  }

  private fromClient(line: string) {
    if (this.closed) return;
    const msg = JSON.parse(line) as Loose;
    this.received.push(msg);
    // Reads the rest of the script doesn't expect are answered at once.
    if (typeof msg.method === "string" && msg.id !== undefined && !this.scriptedNext(msg)) {
      if (Object.hasOwn(this.ambient, msg.method)) {
        this.toClient({ id: msg.id, result: this.ambient[msg.method] });
        return;
      }
    }
    this.inbox.push(msg);
    this.inboxWaiter?.();
  }

  /** Index of the step being played. */
  private at = 0;
  /** Whether a step still to come (or the current one) expects this very message. */
  private scriptedNext(msg: Loose): boolean {
    for (const s of this.steps.slice(this.at)) {
      if (s.expect?.method === msg.method) return true;
      if (s.ask && msg.id === s.ask.id && msg.method === undefined) return true;
    }
    return false;
  }

  private async next(): Promise<Loose | undefined> {
    for (;;) {
      const m = this.inbox.shift();
      if (m) return m;
      if (this.closed) return undefined;
      await new Promise<void>((r) => {
        this.inboxWaiter = r;
      });
      this.inboxWaiter = undefined;
    }
  }

  private async play() {
    for (const [i, step] of this.steps.entries()) {
      if (this.closed) return;
      this.at = i;
      // Let the client run between steps, as a real server's messages arrive apart.
      await Promise.resolve();
      if (step.send) this.toClient({ ...step.send });
      else if (step.crash) {
        this.stop(step.crash.code ?? 1);
        return;
      } else if (step.expect) {
        const msg = await this.next();
        if (!msg) return;
        if (
          msg.method !== step.expect.method ||
          !matches(step.expect.params ?? {}, msg.params ?? {})
        ) {
          this.failures.push(
            `step ${i + 1}: expected ${step.expect.method}, got ${JSON.stringify(msg).slice(0, 300)}`,
          );
          continue;
        }
        if (msg.id === undefined) continue;
        this.toClient(
          step.error
            ? { id: msg.id, error: step.error }
            : { id: msg.id, result: step.result ?? {} },
        );
      } else if (step.ask) {
        this.toClient({ ...step.ask });
        const msg = await this.next();
        if (!msg) return;
        if (msg.id !== step.ask.id || msg.method !== undefined) {
          this.failures.push(`step ${i + 1}: expected the answer to ${step.ask.method}`);
          continue;
        }
        if (step.expectResult !== undefined && !matches(step.expectResult, msg.result))
          this.failures.push(
            `step ${i + 1}: ${step.ask.method} answered ${JSON.stringify(msg.result ?? msg.error)}`,
          );
      }
    }
    this.at = this.steps.length;
  }
}
