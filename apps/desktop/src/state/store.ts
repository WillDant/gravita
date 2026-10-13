import { createStore, type StateCreator, type StoreApi } from "zustand";
import type { EngineGateway } from "@/infrastructure/engine/EngineGateway";
import { type ClockSlice, createClockSlice } from "./slices/clock";
import { type ConnectionSlice, createConnectionSlice } from "./slices/connection";
import { type ControlSlice, createControlSlice } from "./slices/control";
import { type ConversationSlice, createConversationSlice } from "./slices/conversation";
import { createNoticeSlice, type NoticeSlice } from "./slices/notice";
import { createOpenSessionSlice, type OpenSessionSlice } from "./slices/openSession";
import { createProjectionSlice, type ProjectionSlice } from "./slices/projection";
import { createRouteSlice, type Route, type RouteSlice } from "./slices/route";
import { createSquadSlice, type SquadSlice } from "./slices/squad";

export type AppState = ConnectionSlice &
  ProjectionSlice &
  OpenSessionSlice &
  RouteSlice &
  ClockSlice &
  ControlSlice &
  ConversationSlice &
  NoticeSlice &
  SquadSlice;
export type AppStore = StoreApi<AppState>;

/** A slice creator that sees the whole store and gets the engine port injected. */
export type Slice<T> = (gateway: EngineGateway) => StateCreator<AppState, [], [], T>;

export interface AppStoreInit {
  route?: Route;
  now?: number;
}

/** One store per app (or per test). The gateway is injected: no module-level singletons. */
export function createAppStore(gateway: EngineGateway, init: AppStoreInit = {}): AppStore {
  return createStore<AppState>()((...a) => ({
    ...createConnectionSlice(gateway)(...a),
    ...createProjectionSlice(gateway)(...a),
    ...createOpenSessionSlice(gateway)(...a),
    ...createRouteSlice(init.route ?? { level: "home" })(gateway)(...a),
    ...createClockSlice(init.now ?? Date.now())(gateway)(...a),
    ...createControlSlice(gateway)(...a),
    ...createConversationSlice(gateway)(...a),
    ...createNoticeSlice(gateway)(...a),
    ...createSquadSlice(gateway)(...a),
  }));
}
