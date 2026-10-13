import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readSession } from "@gravita/adapter-claude";
import { buildLineMap } from "../src";

const FIXTURE = join(
  import.meta.dir,
  "../../../fixtures/claude/2.1.296/nested-background/11111111-1111-4111-8111-111111111111.jsonl",
);

describe("buildLineMap", () => {
  test("branches subagents off their spawn station and merges them back", async () => {
    const map = buildLineMap(await readSession(FIXTURE, { projectId: "p" }));
    const byId = Object.fromEntries(map.lines.map((l) => [l.agentId, l]));
    const main = byId.main!;
    const explore = byId.a0000000000000001!;
    const plan = byId.a0000000000000002!;
    const nested = byId.a0000000000000003!;

    expect(main.lane).toBe(0);
    const spawnExplore = main.stations.find((s) => s.spawnsAgentId === explore.agentId)!;
    const spawnPlan = main.stations.find((s) => s.spawnsAgentId === plan.agentId)!;
    expect(explore.startCol).toBe(spawnExplore.col);
    expect(plan.startCol).toBe(spawnPlan.col);
    expect(nested.parentId).toBe(plan.agentId);
    expect(nested.depth).toBe(2);
    expect(nested.lane).toBeGreaterThan(plan.lane);
    for (const l of [explore, plan, nested]) {
      expect(l.ended).toBe(true);
      expect(l.endCol!).toBeGreaterThan(l.startCol);
    }
  });

  test("sequential subagents reuse a lane; parallel ones don't", async () => {
    const map = buildLineMap(await readSession(FIXTURE, { projectId: "p" }));
    const byId = Object.fromEntries(map.lines.map((l) => [l.agentId, l]));
    // Explore finished before Plan started, so Plan reuses lane 1.
    expect(byId.a0000000000000001!.lane).toBe(1);
    expect(byId.a0000000000000002!.lane).toBe(1);
    expect(map.lanes).toBe(3);
  });

  test("stations carry kind, label and completion status", async () => {
    const map = buildLineMap(await readSession(FIXTURE, { projectId: "p" }));
    const all = map.lines.flatMap((l) => l.stations);
    const read = all.find((s) => s.name === "Read")!;
    expect(read).toMatchObject({ kind: "read", label: "auth.ts", status: "ok", count: 1 });
    const edit = all.find((s) => s.name === "Edit")!;
    expect(edit.agentId).toBe("a0000000000000003");
    expect(all.every((s) => s.status === "ok")).toBe(true);
  });

  test("is deterministic and independent of duplicate events", async () => {
    const events = await readSession(FIXTURE, { projectId: "p" });
    expect(buildLineMap([...events, ...events])).toEqual(buildLineMap(events));
  });
});
