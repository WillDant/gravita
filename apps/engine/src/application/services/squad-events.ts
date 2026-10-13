import type { EventOf, GravitaEventType } from "@gravita/protocol";

/** Squad events Gravita emits about git and checks. */
export type SquadGitEventType = Extract<
  GravitaEventType,
  | "commit.created"
  | "ownership.violation"
  | "merge.started"
  | "merge.succeeded"
  | "merge.conflicted"
  | "merge.reverted"
  | "check.ran"
  | "contract.frozen"
  | "squad.delivered"
>;

/**
 * Builds a squad event: Gravita is both source and provider, and the envelope carries no
 * session (the squad id is in the data).
 */
export function squadEvent<T extends SquadGitEventType>(
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
