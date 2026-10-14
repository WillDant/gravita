import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ModelInfo,
  Options,
  PermissionMode,
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { AsyncQueue } from "../src/infrastructure/claude/sdk/async-queue";
import type { QueryFn } from "../src/infrastructure/claude/sdk/claude-sdk-runtime";

// A scripted stand-in for the Agent SDK's Query: tests push SDK messages into its stream,
// read what the runtime sent, and see which control methods were called. No Claude Code runs.

export const SDK_FIXTURES = join(import.meta.dir, "../../../fixtures/claude-sdk/0.3.296");

export function sdkFixture(name: string): SDKMessage[] {
  return readFileSync(join(SDK_FIXTURES, `${name}.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as SDKMessage);
}

export class ScriptedQuery {
  readonly calls: string[] = [];
  readonly prompts: SDKUserMessage[] = [];
  closed = false;
  /** When true, `close` doesn't end the stream (a stuck Claude Code). */
  stuck = false;
  models: ModelInfo[] = [
    { value: "default", displayName: "Default", description: "" },
    { value: "opus", displayName: "Opus", description: "" },
  ];
  private readonly out = new AsyncQueue<SDKMessage>();
  private error: Error | undefined;
  private readonly waiters: (() => void)[] = [];

  constructor(readonly params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) {
    void (async () => {
      for await (const m of params.prompt) {
        this.prompts.push(m);
        for (const w of this.waiters.splice(0)) w();
      }
    })();
  }

  get options(): Options {
    return this.params.options;
  }

  /** Resolves once the runtime has sent `n` messages. */
  async waitForPrompts(n: number) {
    while (this.prompts.length < n) await new Promise<void>((r) => this.waiters.push(r));
  }

  emit(...msgs: SDKMessage[]) {
    for (const m of msgs) this.out.push(m);
  }

  end() {
    this.out.close();
  }

  fail(err: Error) {
    this.error = err;
    this.out.close();
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    const it = this.out[Symbol.asyncIterator]();
    return {
      next: async () => {
        const r = await it.next();
        if (r.done && this.error) throw this.error;
        return r;
      },
    };
  }

  async interrupt() {
    this.calls.push("interrupt");
    return undefined;
  }

  async setModel(model?: string) {
    this.calls.push(`model:${model ?? "<default>"}`);
  }

  async setPermissionMode(mode: PermissionMode) {
    this.calls.push(`mode:${mode}`);
  }

  async stopTask(taskId: string) {
    this.calls.push(`stopTask:${taskId}`);
  }

  async supportedModels() {
    return this.models;
  }

  /**
   * What the Agent SDK's experimental usage read answers (undefined: an unexpected shape);
   * set `usageError` to make it throw. `usageReads` counts the calls.
   */
  usageAnswer: unknown;
  usageError: Error | undefined;
  usageReads = 0;

  async usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(opts?: {
    skipBehaviors?: boolean;
  }) {
    this.usageReads++;
    this.calls.push(`usage:${opts?.skipBehaviors ? "skipBehaviors" : "full"}`);
    if (this.usageError) throw this.usageError;
    return this.usageAnswer;
  }

  close() {
    this.calls.push("close");
    this.closed = true;
    if (!this.stuck) this.out.close();
  }
}

/** A QueryFn that records every query it creates. */
export function scriptedQueryFn(): { queryFn: QueryFn; queries: ScriptedQuery[] } {
  const queries: ScriptedQuery[] = [];
  const queryFn: QueryFn = (params) => {
    const q = new ScriptedQuery(params);
    queries.push(q);
    return q as unknown as Query;
  };
  return { queryFn, queries };
}

/** Lets pending promise callbacks and async iterations run. */
export async function settle(times = 5) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

/** A `rate_limit_event`, as Claude Code sends when a plan window's usage changes. */
export function rateLimitEvent(
  utilization: number,
  o: { type?: string; status?: string; resetsAt?: number; uuid?: string } = {},
): SDKMessage {
  return {
    type: "rate_limit_event",
    rate_limit_info: {
      status: o.status ?? "allowed",
      rateLimitType: o.type ?? "five_hour",
      utilization,
      ...(o.resetsAt !== undefined ? { resetsAt: o.resetsAt } : {}),
    },
    uuid: o.uuid ?? `rl-${++rateLimitSeq}`,
    session_id: "",
  } as unknown as SDKMessage;
}
let rateLimitSeq = 0;

/** The usage read's answer for a subscription with these windows (percents). */
export function usageAnswer(windows: Record<string, number>, resetsAt?: string): unknown {
  return {
    session: {},
    subscription_type: "max",
    rate_limits_available: true,
    rate_limits: Object.fromEntries(
      Object.entries(windows).map(([k, u]) => [k, { utilization: u, resets_at: resetsAt ?? null }]),
    ),
    behaviors: null,
  };
}

/** The usage read's answer for an API-key account. */
export const API_KEY_USAGE = {
  session: {},
  subscription_type: null,
  rate_limits_available: false,
  rate_limits: null,
  behaviors: null,
};
