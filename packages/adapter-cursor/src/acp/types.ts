// The part of the Agent Client Protocol (ACP, protocol version 1) that Gravita speaks with
// `cursor-agent acp`, as the tested CLI (2026.10.14, @agentclientprotocol/sdk 0.14) sends it.
// Only the fields Gravita reads are typed; everything else the agent sends is ignored, so a
// newer CLI's extra fields change nothing.

export const ACP_PROTOCOL_VERSION = 1;

export interface Implementation {
  name: string;
  title?: string;
  version?: string;
}

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities: {
    fs: { readTextFile: boolean; writeTextFile: boolean };
    terminal: boolean;
  };
  clientInfo?: Implementation;
}

export interface AuthMethod {
  id: string;
  name?: string;
  description?: string | null;
}

export interface InitializeResponse {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
    mcpCapabilities?: { http?: boolean; sse?: boolean };
  };
  authMethods?: AuthMethod[];
}

export interface SessionMode {
  id: string;
  name?: string;
  description?: string | null;
}

export interface ModelInfo {
  modelId: string;
  name?: string;
  description?: string | null;
}

export interface NewSessionParams {
  cwd: string;
  mcpServers: unknown[];
}

export interface NewSessionResponse {
  sessionId: string;
  modes?: { currentModeId: string; availableModes: SessionMode[] } | null;
  models?: { currentModelId: string; availableModels: ModelInfo[] } | null;
}

export interface LoadSessionParams extends NewSessionParams {
  sessionId: string;
}

export type LoadSessionResponse = Omit<NewSessionResponse, "sessionId">;

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: string; [k: string]: unknown };

export interface PromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";

export interface PromptResponse {
  stopReason: StopReason | (string & {});
}

export interface CancelParams {
  sessionId: string;
}

export interface SetModeParams {
  sessionId: string;
  modeId: string;
}

export interface SetModelParams {
  sessionId: string;
  modelId: string;
}

/** ACP's kinds of tool call (what the agent says the call does). */
export type AcpToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface ToolCallLocation {
  path: string;
  line?: number | null;
}

export type ToolCallContent =
  | { type: "content"; content: ContentBlock }
  | { type: "diff"; path: string; oldText?: string | null; newText: string }
  | { type: "terminal"; terminalId: string };

/** A tool call as `tool_call` announces it (and a permission request restates it). */
export interface ToolCall {
  toolCallId: string;
  title?: string;
  kind?: AcpToolKind | (string & {});
  status?: ToolCallStatus | (string & {});
  rawInput?: unknown;
  rawOutput?: unknown;
  content?: ToolCallContent[] | null;
  locations?: ToolCallLocation[] | null;
}

export interface PlanEntry {
  content: string;
  status: "pending" | "in_progress" | "completed" | (string & {});
  priority?: string;
}

export type SessionUpdate =
  | { sessionUpdate: "agent_message_chunk"; content: ContentBlock }
  | { sessionUpdate: "agent_thought_chunk"; content: ContentBlock }
  | { sessionUpdate: "user_message_chunk"; content: ContentBlock }
  | ({ sessionUpdate: "tool_call" } & ToolCall)
  | ({ sessionUpdate: "tool_call_update" } & ToolCall)
  | { sessionUpdate: "plan"; entries: PlanEntry[] }
  | { sessionUpdate: "current_mode_update"; currentModeId: string }
  | { sessionUpdate: "session_info_update"; title?: string | null }
  | { sessionUpdate: "available_commands_update"; availableCommands?: unknown[] };

export interface SessionNotification {
  sessionId: string;
  update: SessionUpdate;
}

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface PermissionOption {
  optionId: string;
  name?: string;
  kind: PermissionOptionKind | (string & {});
}

export interface RequestPermissionParams {
  sessionId: string;
  toolCall: ToolCall;
  options: PermissionOption[];
}

export type RequestPermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export interface RequestPermissionResponse {
  outcome: RequestPermissionOutcome;
}
