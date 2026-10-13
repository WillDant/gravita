import { applyAll, emptyState, type GravitaState } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";

// Small builders for tests: events in the protocol's shape and states built with the
// same reducer the engine and the UI use.

export const NOW = Date.parse("2026-10-12T12:00:00.000Z");

/** ISO timestamp `minutesAgo` before NOW. */
export const ago = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

type EventOf<T extends GravitaEvent["type"]> = Extract<GravitaEvent, { type: T }>;

let seq = 0;

export function ev<T extends GravitaEvent["type"]>(
  type: T,
  data: EventOf<T>["data"],
  at: { ts?: string; projectId?: string; sessionId?: string; agentId?: string } = {},
): GravitaEvent {
  seq++;
  return {
    key: `${type}:${seq}`,
    ts: at.ts ?? ago(0),
    source: "fake",
    provider: "fake",
    projectId: at.projectId ?? "p1",
    ...(at.sessionId ? { sessionId: at.sessionId } : {}),
    ...(at.agentId ? { agentId: at.agentId } : {}),
    type,
    data,
  } as GravitaEvent;
}

/** A session that started `minutesAgo` in project `projectId`. */
export function started(
  sessionId: string,
  minutesAgo: number,
  projectId = "p1",
  kind: "chat" | "external" = "external",
): GravitaEvent[] {
  return [
    ev(
      "project.discovered",
      { root: `/work/${projectId}`, name: projectId },
      { ts: ago(minutesAgo), projectId },
    ),
    ev(
      "session.started",
      { kind, cwd: `/work/${projectId}` },
      { ts: ago(minutesAgo), projectId, sessionId },
    ),
  ];
}

export function stateOf(...events: GravitaEvent[][]): GravitaState {
  return applyAll(emptyState(), events.flat());
}
