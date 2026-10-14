import type {
  AccountRateLimitsUpdatedNotification,
  AccountUpdatedNotification,
  AgentMessageDeltaNotification,
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  ErrorNotification,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  GetAccountParams,
  GetAccountRateLimitsParams,
  GetAccountRateLimitsResponse,
  GetAccountResponse,
  InitializeParams,
  InitializeResponse,
  ItemCompletedNotification,
  ItemStartedNotification,
  McpServerElicitationRequestResponse,
  ModelListParams,
  ModelListResponse,
  PermissionsRequestApprovalParams,
  PermissionsRequestApprovalResponse,
  RawResponseItemCompletedNotification,
  ServerRequestResolvedNotification,
  ThreadResumeParams,
  ThreadResumeResponse,
  ThreadStartedNotification,
  ThreadStartParams,
  ThreadStartResponse,
  ThreadStatusChangedNotification,
  ThreadTokenUsageUpdatedNotification,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
  TurnCompletedNotification,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartedNotification,
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
} from "./protocol";

// The part of the app-server protocol Gravita speaks, method by method, in the vendored
// types of the Codex release it was tested with (see protocol/). Anything else the server
// sends is ignored (notifications) or declined (requests).

/** Requests Gravita sends: method → [params, result]. */
export interface ClientRequests {
  initialize: [InitializeParams, InitializeResponse];
  "thread/start": [ThreadStartParams, ThreadStartResponse];
  "thread/resume": [ThreadResumeParams, ThreadResumeResponse];
  "turn/start": [TurnStartParams, TurnStartResponse];
  "turn/steer": [TurnSteerParams, TurnSteerResponse];
  "turn/interrupt": [TurnInterruptParams, TurnInterruptResponse];
  "model/list": [ModelListParams, ModelListResponse];
  "account/read": [GetAccountParams, GetAccountResponse];
  "account/rateLimits/read": [GetAccountRateLimitsParams, GetAccountRateLimitsResponse];
}

export type ClientMethod = keyof ClientRequests;

/** Notifications Gravita reads: method → params. */
export interface ServerNotifications {
  "thread/started": ThreadStartedNotification;
  "thread/status/changed": ThreadStatusChangedNotification;
  "thread/tokenUsage/updated": ThreadTokenUsageUpdatedNotification;
  "turn/started": TurnStartedNotification;
  "turn/completed": TurnCompletedNotification;
  "item/started": ItemStartedNotification;
  "item/completed": ItemCompletedNotification;
  "item/agentMessage/delta": AgentMessageDeltaNotification;
  "rawResponseItem/completed": RawResponseItemCompletedNotification;
  "serverRequest/resolved": ServerRequestResolvedNotification;
  "account/updated": AccountUpdatedNotification;
  "account/rateLimits/updated": AccountRateLimitsUpdatedNotification;
  error: ErrorNotification;
}

export type ServerNotificationMethod = keyof ServerNotifications;

/** What the server asks the client: method → [params, result]. */
export interface ServerRequests {
  "item/commandExecution/requestApproval": [
    CommandExecutionRequestApprovalParams,
    CommandExecutionRequestApprovalResponse,
  ];
  "item/fileChange/requestApproval": [
    FileChangeRequestApprovalParams,
    FileChangeRequestApprovalResponse,
  ];
  "item/permissions/requestApproval": [
    PermissionsRequestApprovalParams,
    PermissionsRequestApprovalResponse,
  ];
  "item/tool/requestUserInput": [ToolRequestUserInputParams, ToolRequestUserInputResponse];
  "mcpServer/elicitation/request": [unknown, McpServerElicitationRequestResponse];
}

export type ServerRequestMethod = keyof ServerRequests;

/** A notification, narrowed by its method. */
export type ServerNotification = {
  [M in ServerNotificationMethod]: { method: M; params: ServerNotifications[M] };
}[ServerNotificationMethod];

/** A server request, narrowed by its method. */
export type ServerRequest = {
  [M in ServerRequestMethod]: { method: M; params: ServerRequests[M][0] };
}[ServerRequestMethod];

const NOTIFICATIONS: ReadonlySet<string> = new Set<ServerNotificationMethod>([
  "thread/started",
  "thread/status/changed",
  "thread/tokenUsage/updated",
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "rawResponseItem/completed",
  "serverRequest/resolved",
  "account/updated",
  "account/rateLimits/updated",
  "error",
]);

const REQUESTS: ReadonlySet<string> = new Set<ServerRequestMethod>([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
]);

/** Whether `method` is a notification Gravita reads (its params are trusted to its type). */
export function isKnownNotification(method: string): method is ServerNotificationMethod {
  return NOTIFICATIONS.has(method);
}

export function isKnownServerRequest(method: string): method is ServerRequestMethod {
  return REQUESTS.has(method);
}
