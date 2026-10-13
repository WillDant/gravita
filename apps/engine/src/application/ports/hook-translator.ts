import type { AgentProvider, GravitaEvent } from "@gravita/protocol";

// What a provider's hook means to the engine. The translator (infrastructure) parses the
// provider's payload and maps it to events; `HookIngest` keeps the prompt bookkeeping.

/** One tool call, tracked so a permission prompt can be tied to the call that raised it. */
export interface HookToolCall {
  toolUseId: string;
  toolName: string;
  /** Equal for the same tool and input: ties a prompt to its call. */
  inputKey: string;
  inputPreview: string;
}

export type HookSignal =
  | { kind: "tool-start"; call: HookToolCall }
  | { kind: "tool-end"; toolUseId: string; inputKey: string | undefined; ok: boolean }
  | {
      kind: "prompt";
      /** "notification": the prompt names no tool; it belongs to the agent's open call. */
      via: "request" | "notification";
      toolName?: string;
      inputKey?: string;
      inputPreview?: string;
    }
  /** The agent's turn is over (its prompts too). */
  | { kind: "turn-end" }
  /** The session is over. */
  | { kind: "session-end" };

export interface HookMapping {
  sessionId: string;
  agentId: string;
  events: GravitaEvent[];
  signal?: HookSignal;
}

/** A hook that parsed; `map` turns it into events once its project is known. */
export interface ParsedHook {
  sessionId: string;
  agentId: string;
  /** The session's working directory, to resolve its project. */
  cwd: string | undefined;
  /** When the hook fired, if it was spooled while the engine was away (ms since epoch). */
  spooledAt: number | undefined;
  map(ctx: { projectId: string; ts: string }): HookMapping;
}

export interface HookTranslator {
  /** Whose hooks these are: the provider of every event they become. */
  readonly provider: AgentProvider;
  /** null: malformed, or an event the engine doesn't read. */
  parse(raw: unknown): ParsedHook | null;
}
