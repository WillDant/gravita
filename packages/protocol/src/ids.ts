// Deterministic ids and idempotency keys. Every source (SDK stream, transcript tailer,
// hooks) must derive the same id for the same thing, across restarts. Never random.

export type Provider = "claude" | "codex" | "gravita" | "fake";

/** Id of the main agent of a session. */
export const MAIN_AGENT = "main";

export function sessionNodeId(provider: Provider, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

export function agentNodeId(provider: Provider, sessionId: string, agentId: string): string {
  return `${provider}:${sessionId}:${agentId}`;
}

export function toolNodeId(provider: Provider, toolUseId: string): string {
  return `${provider}:${toolUseId}`;
}

/** Idempotency keys. Same fact from any source → same key → stored once. */
export const keys = {
  sessionStarted: (sid: string) => `session:${sid}:started`,
  sessionEnded: (sid: string) => `session:${sid}:ended`,
  agentSpawned: (sid: string, agentId: string) => `agent:${sid}:${agentId}:spawned`,
  agentCompleted: (sid: string, agentId: string) => `agent:${sid}:${agentId}:completed`,
  agentLifecycle: (sid: string, agentId: string, status: string) =>
    `agent:${sid}:${agentId}:lifecycle:${status}`,
  toolStarted: (toolUseId: string) => `tool:${toolUseId}:started`,
  toolCompleted: (toolUseId: string) => `tool:${toolUseId}:completed`,
  assistantBlock: (messageId: string, blockKind: string, discriminator: string) =>
    `msg:${messageId}:${blockKind}:${discriminator}`,
  userMessage: (uuid: string) => `user:${uuid}`,
  usage: (messageId: string) => `usage:${messageId}`,
  turnCompleted: (sid: string, uuid: string) => `turn:${sid}:${uuid}`,
  permissionRequested: (requestId: string) => `perm:${requestId}:requested`,
  permissionResolved: (requestId: string) => `perm:${requestId}:resolved`,
} as const;
