import { buildLineMap, type Station } from "@gravita/core";
import type { ConversationMessage, GravitaEvent, ToolKind } from "@gravita/protocol";
import { MAIN_AGENT } from "@gravita/protocol/ids";

/** Where the steps taken before the first message go. */
export const BEFORE_FIRST = "";

/**
 * The main agent's tool calls, grouped under the message they follow: message uuid → its
 * stations, in time order. Subagent spawns are left out (the message's chips show them).
 */
export function toolStepsByMessage(
  events: GravitaEvent[],
  messages: readonly ConversationMessage[],
  agentId: string = MAIN_AGENT,
): Map<string, Station[]> {
  const stations = buildLineMap(events).lines.find((l) => l.agentId === agentId)?.stations ?? [];
  const groups = new Map<string, Station[]>();
  for (const s of stations) {
    if (s.kind === "agent") continue;
    let after = BEFORE_FIRST;
    for (const m of messages) {
      if (m.ts <= s.startTs) after = m.uuid;
    }
    const group = groups.get(after);
    if (group) group.push(s);
    else groups.set(after, [s]);
  }
  return groups;
}

export interface StepSummary {
  kind: ToolKind;
  count: number;
  /** The first call's target, for a kind used once. */
  target: string;
}

/** Calls per tool kind, in the order each kind first appears. */
export function summarizeSteps(stations: readonly Station[]): StepSummary[] {
  const byKind = new Map<ToolKind, StepSummary>();
  for (const s of stations) {
    const cur = byKind.get(s.kind);
    if (cur) cur.count += s.count;
    else byKind.set(s.kind, { kind: s.kind, count: s.count, target: s.label });
  }
  return [...byKind.values()];
}
