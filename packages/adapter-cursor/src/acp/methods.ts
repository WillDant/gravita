import type {
  CancelParams,
  InitializeParams,
  InitializeResponse,
  LoadSessionParams,
  LoadSessionResponse,
  NewSessionParams,
  NewSessionResponse,
  PromptParams,
  PromptResponse,
  RequestPermissionParams,
  RequestPermissionResponse,
  SessionNotification,
  SetModelParams,
  SetModeParams,
} from "./types";

// The ACP methods Gravita speaks, method by method. Anything else the agent sends is ignored
// (notifications) or declined (requests): Gravita declares no file system or terminal
// capability, and doesn't answer Cursor's own extensions (questions, plans), so the agent
// does those itself or goes on without them. `authenticate` is never sent: without a key in
// its environment it would start a browser login.

/** Requests Gravita sends: method → [params, result]. */
export interface ClientRequests {
  initialize: [InitializeParams, InitializeResponse];
  "session/new": [NewSessionParams, NewSessionResponse];
  "session/load": [LoadSessionParams, LoadSessionResponse];
  "session/prompt": [PromptParams, PromptResponse];
  "session/set_mode": [SetModeParams, Record<string, never> | null];
  "session/set_model": [SetModelParams, Record<string, never> | null];
}
export type ClientMethod = keyof ClientRequests;

/** Notifications Gravita sends. */
export interface ClientNotifications {
  "session/cancel": CancelParams;
}

/** Notifications from the agent that Gravita reads. */
export interface ServerNotifications {
  "session/update": SessionNotification;
}
export type ServerNotificationMethod = keyof ServerNotifications;
export type ServerNotification = {
  [M in ServerNotificationMethod]: { method: M; params: ServerNotifications[M] };
}[ServerNotificationMethod];

/** Requests from the agent that Gravita answers: method → [params, result]. */
export interface ServerRequests {
  "session/request_permission": [RequestPermissionParams, RequestPermissionResponse];
}
export type ServerRequestMethod = keyof ServerRequests;
export type ServerRequest = {
  [M in ServerRequestMethod]: { method: M; params: ServerRequests[M][0] };
}[ServerRequestMethod];

const NOTIFICATIONS: ReadonlySet<string> = new Set<ServerNotificationMethod>(["session/update"]);
const REQUESTS: ReadonlySet<string> = new Set<ServerRequestMethod>(["session/request_permission"]);

export const isKnownNotification = (method: string): method is ServerNotificationMethod =>
  NOTIFICATIONS.has(method);

export const isKnownServerRequest = (method: string): method is ServerRequestMethod =>
  REQUESTS.has(method);
