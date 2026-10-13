import type { AgentNode } from "@gravita/core";
import { allocateMotion, type MotionCandidate } from "@gravita/orbs";
import { useMemo } from "react";

/** When the agent's state last changed: its newest ask, else its last event (ms). */
export function changedAt(node: AgentNode): number | undefined {
  const asks = [...Object.values(node.permissions), ...Object.values(node.questions)];
  const ts = asks.length ? Math.max(...asks.map((a) => Date.parse(a.ts) || 0)) : 0;
  return ts || Date.parse(node.lastEventTs) || undefined;
}

/**
 * The 1/3 rule for a crowd of orbs: ids allowed primary motion. Memoized on what the
 * allocation reads, so the set (and the orbs) stay stable while nothing relevant changes.
 */
export function useMotionBudget(
  candidates: readonly MotionCandidate[],
  now: number,
): ReadonlySet<string> {
  const signature = candidates
    .map((c) => `${c.id}:${c.mood}:${c.spawnedAt ?? ""}:${c.changedAt ?? ""}`)
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the signature stands for the candidates.
  return useMemo(() => allocateMotion(candidates, now), [signature]);
}
