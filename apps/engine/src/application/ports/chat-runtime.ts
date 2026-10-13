import type { PermissionMode } from "@gravita/protocol";
import type { ClaudeEnvironment } from "./claude-environment";
import type { SessionRuntime } from "./session-runtime";

export interface ChatRuntimeSpec {
  sessionId: string;
  projectId: string;
  cwd: string;
  model?: string;
  permissionMode: PermissionMode;
  environment: ClaudeEnvironment;
}

/** A chat session's runtime. `start` begins consuming the agent's stream. */
export interface ChatRuntime extends SessionRuntime {
  start(): void;
}

/** Creates the runtime of a new chat session (Claude Code through the Agent SDK). */
export interface ChatRuntimeFactory {
  create(spec: ChatRuntimeSpec): ChatRuntime;
}
