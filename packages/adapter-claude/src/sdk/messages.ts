import type { ContentBlock, Usage } from "../transcript/records";

// Loose shapes of the Claude Agent SDK's stream messages (SDKMessage). Like the transcript
// records, parsing is an allowlist: only the fields Gravita reads are named, so this
// package doesn't depend on the SDK and a newer SDK with more fields still maps.

/** `assistant` and `user` messages: the same Messages API payload the transcript stores. */
export interface SdkConversationMessage {
  type: "assistant" | "user";
  uuid?: string;
  session_id?: string;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: string | ContentBlock[];
    stop_reason?: string | null;
    usage?: Usage;
  };
  parent_tool_use_id?: string | null;
  /** Subagent that wrote the message (assistant messages, SDK ≥ 0.3.296). */
  agent_id?: string;
  /** e.g. "authentication_failed" when Claude Code isn't logged in. */
  error?: string;
  tool_use_result?: unknown;
  isSynthetic?: boolean;
  isReplay?: boolean;
}

export interface SdkTaskUsage {
  total_tokens?: number;
  tool_uses?: number;
  duration_ms?: number;
}

export interface SdkSystemMessage {
  type: "system";
  subtype?: string;
  uuid?: string;
  session_id?: string;
  timestamp?: string;
  task_id?: string;
  tool_use_id?: string;
  task_type?: string;
  description?: string;
  subagent_type?: string;
  is_backgrounded?: boolean;
  spawn_depth?: number;
  parent_task_id?: string;
  usage?: SdkTaskUsage;
  last_tool_name?: string;
  summary?: string;
  status?: string;
  patch?: { status?: string };
  compact_metadata?: { trigger?: string; pre_tokens?: number };
}

export interface SdkResultMessage {
  type: "result";
  subtype?: string;
  uuid?: string;
  session_id?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
}

export type SdkMessageLike = SdkConversationMessage | SdkSystemMessage | SdkResultMessage;
