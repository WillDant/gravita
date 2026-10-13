import type { EventOf, GravitaEventType } from "@gravita/protocol";

/** Every squad event: they belong to a squad (its id is in the data), not to a session. */
export type SquadEventType = Extract<
  GravitaEventType,
  | "squad.created"
  | "squad.phase_changed"
  | "plan.proposed"
  | "plan.rejected"
  | "plan.edited"
  | "plan.approved"
  | "task.status_changed"
  | "task.added"
  | "note.posted"
  | "change_request.opened"
  | "change_request.resolved"
  | "contract.frozen"
  | "commit.created"
  | "ownership.violation"
  | "merge.started"
  | "merge.succeeded"
  | "merge.conflicted"
  | "merge.reverted"
  | "check.ran"
  | "budget.warned"
  | "budget.exhausted"
  | "squad.budget_changed"
  | "squad.paused"
  | "squad.resumed"
  | "squad.delivered"
>;

/**
 * Builds a squad event: Gravita is both source and provider, and the envelope carries no
 * session (the squad id is in the data).
 */
export function squadEvent<T extends SquadEventType>(
  type: T,
  o: { key: string; ts: string; projectId: string },
  data: EventOf<T>["data"],
): EventOf<T> {
  return {
    key: o.key,
    ts: o.ts,
    source: "gravita",
    provider: "gravita",
    projectId: o.projectId,
    type,
    data,
  } as EventOf<T>;
}
