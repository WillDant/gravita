import { describe, expect, it } from "vitest";
import { SQ, squadFixture } from "@/test/squadFixtures";
import { squadView } from "../../model";
import {
  COL_MIN,
  GUTTER,
  LANE_MIN,
  layoutSquadMap,
  type MapTask,
  SIGN_CHAR_W,
  type SquadMapInput,
  TITLE_GAP,
} from "./geometry";

const roles = [
  { id: "backend", colorKey: "backend", name: "Backend", code: "B" },
  { id: "frontend", colorKey: "frontend", name: "Frontend", code: "F" },
];
const texts = {
  trunk: "Integration",
  planner: "Planner",
  foundation: "Foundation",
  build: "Build",
  verify: "Verify",
  deliver: "Deliver",
  hold: "waiting for you",
  failed: "failed",
  conflicted: "conflict",
  reverted: "reverted",
};
const task = (id: string, role: string, extra: Partial<MapTask> = {}): MapTask => ({
  id,
  role,
  title: id,
  status: "pending",
  foundation: false,
  ...extra,
});
const input = (tasks: MapTask[], extra: Partial<SquadMapInput> = {}): SquadMapInput => ({
  roles,
  tasks,
  heads: {},
  texts,
  ...extra,
});
const frame = { w: 1000, h: 600 };

/** Gaps between neighbouring station titles that share a lane and a text row. */
function sameRowGaps(l: ReturnType<typeof layoutSquadMap>): number[] {
  const rows = new Map<string, { x1: number; x2: number }[]>();
  for (const s of l.stations) {
    s.label.lines.forEach((line, i) => {
      const key = `${s.cy}:${Math.round(s.label.y + i * 13)}`;
      const half = (line.length * SIGN_CHAR_W) / 2;
      rows.set(key, [...(rows.get(key) ?? []), { x1: s.label.x - half, x2: s.label.x + half }]);
    });
  }
  const gaps: number[] = [];
  for (const row of rows.values()) {
    row.sort((a, b) => a.x1 - b.x1);
    for (let i = 1; i < row.length; i++) gaps.push(row[i]!.x1 - row[i - 1]!.x2);
  }
  return gaps;
}
const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("layoutSquadMap", () => {
  it("puts the trunk on top and one lane per role below it", () => {
    const l = layoutSquadMap(input([task("a", "backend"), task("b", "frontend")]), frame);
    const trunkY = l.terminus.y;
    const [b, f] = l.stations;
    expect(b?.cy).toBeGreaterThan(trunkY);
    expect(f?.cy).toBeGreaterThan(b?.cy ?? 0);
    expect((f?.cy ?? 0) - (b?.cy ?? 0)).toBe(l.laneH);
    expect(l.laneH).toBeGreaterThanOrEqual(LANE_MIN);
    // The planner is the origin terminal, left of the trunk, in the gutter's edge.
    expect(l.origin.cy).toBe(trunkY);
    expect(l.origin.cx).toBeLessThan(GUTTER + 12);
  });

  it("gives every task its own column, in order", () => {
    const l = layoutSquadMap(
      input([task("a", "backend"), task("b", "frontend"), task("c", "backend")]),
      frame,
    );
    const xs = l.stations.map((s) => s.cx);
    expect(xs).toEqual([...xs].sort((x, y) => x - y));
    expect(new Set(xs).size).toBe(3);
    expect(xs[1]! - xs[0]!).toBeCloseTo(l.colW);
  });

  it("leaves the trunk on a vertical drop and a 45° knee for each role", () => {
    const l = layoutSquadMap(input([task("a", "backend", { status: "running" })]), frame);
    const line = l.lines.find((x) => x.id === "backend");
    expect(line?.built).toMatch(/^M [\d.]+ [\d.]+ V [\d.]+ L [\d.]+ [\d.]+ H/);
    const [x0, , yKnee, x1, y1] = nums(line?.built ?? "");
    expect(x1! - x0!).toBeCloseTo(y1! - yKnee!); // 45°
    const spawn = l.capsules.find((c) => c.kind === "spawn" && c.roleId === "backend");
    expect(spawn?.cy).toBe(l.terminus.y);
  });

  it("draws work not yet started faint, and built work solid", () => {
    const l = layoutSquadMap(
      input([task("a", "backend", { status: "done" }), task("b", "backend")]),
      frame,
    );
    const line = l.lines.find((x) => x.id === "backend");
    expect(line?.built).not.toBe("");
    expect(line?.planned).not.toBe("");
    const idle = layoutSquadMap(input([task("a", "frontend")]), frame).lines[0];
    expect(idle?.built).toBe("");
    expect(idle?.planned).not.toBe("");
  });

  it("raises each merge back into the trunk at an interchange, red when it went wrong", () => {
    const l = layoutSquadMap(
      input([
        task("a", "backend", { status: "done", merge: "succeeded" }),
        task("b", "frontend", { status: "blocked", merge: "conflicted" }),
      ]),
      frame,
    );
    expect(l.spurs.map((s) => [s.taskId, s.state])).toEqual([
      ["a", "succeeded"],
      ["b", "conflicted"],
    ]);
    const merge = l.capsules.find((c) => c.kind === "merge" && c.taskId === "a");
    expect(merge?.cy).toBe(l.terminus.y);
    // The spur is octolinear: a 45° knee off the role line, then straight up.
    expect(l.spurs[0]?.d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+ V [\d.]+$/);
    // Only the good merge builds the trunk out.
    expect(nums(l.trunk.built).at(-1)).toBeCloseTo(merge?.cx ?? 0);
  });

  it("rides the role's orb just past its running station, with signage under it", () => {
    const l = layoutSquadMap(
      input([task("a", "backend", { status: "running" })], {
        heads: { backend: { label: "is editing app.ts", held: false } },
      }),
      frame,
    );
    const station = l.stations[0];
    expect(l.heads[0]?.cx).toBeGreaterThan(station?.cx ?? 0);
    expect(l.signage[0]).toMatchObject({ text: "is editing app.ts", held: false, anchor: "end" });
  });

  it("holds a blocked station in orange signage when no session is on it", () => {
    const l = layoutSquadMap(input([task("a", "backend", { status: "blocked" })]), frame);
    expect(l.heads).toEqual([]);
    expect(l.signage[0]).toMatchObject({ text: "waiting for you", held: true });
  });

  it("marks where the foundation ends", () => {
    const l = layoutSquadMap(
      input([task("a", "backend", { foundation: true }), task("b", "frontend")]),
      frame,
    );
    const [rule] = l.zone.rules;
    expect(rule).toBeGreaterThan(l.stations[0]?.cx ?? 0);
    expect(rule).toBeLessThan(l.stations[1]?.cx ?? 0);
    // Verify and the Deliver terminus follow the last task, as on the header's track.
    expect(l.zone.labels.map((z) => z.text)).toEqual(["Foundation", "Build", "Verify", "Deliver"]);
    expect(l.zone.rules.at(-1)).toBeLessThan(l.terminus.x);
  });

  it("compresses columns for forty tasks and scrolls rather than squeezing further", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      task(`t${i}`, i % 2 ? "frontend" : "backend"),
    );
    const l = layoutSquadMap(input(many), { w: 700, h: 600 });
    expect(l.colW).toBe(COL_MIN);
    expect(l.width).toBeGreaterThan(700);
  });

  it("names every station in full, alternating sides when neighbours are close", () => {
    const tasks = Array.from({ length: 8 }, (_, i) =>
      task(`t${i}`, "backend", { title: `Build the todo routes number ${i}` }),
    );
    const crowded = layoutSquadMap(input(tasks), { w: 600, h: 500 });
    expect(crowded.stations.every((s) => s.label.lines.length > 0)).toBe(true);
    expect(new Set(crowded.stations.map((s) => s.label.above))).toEqual(new Set([true, false]));
    const mixed = tasks.map((x, i) => ({ ...x, role: i % 2 ? "frontend" : "backend" }));
    const roomy = layoutSquadMap(input(mixed), { w: 1000, h: 500 });
    expect(roomy.stations.map((s) => s.label.lines.join(" "))).toEqual(mixed.map((x) => x.title));
  });

  it("names a failed station and a conflicted merge in words, in red", () => {
    const l = layoutSquadMap(
      input([task("a", "backend", { status: "failed", merge: "conflicted" })]),
      frame,
    );
    const words = l.signage.filter((g) => g.error).map((g) => g.text);
    expect(words.sort()).toEqual(["conflict", "failed"]);
  });

  it("names the trunk once, in the gutter, and gives the planner its own signage", () => {
    const l = layoutSquadMap(input([task("a", "backend")], { plannerLabel: "finished" }), frame);
    expect(l.labels.filter((x) => x.trunk).map((x) => [x.text, x.x])).toEqual([
      ["Integration", 12],
    ]);
    expect(l.labels.some((x) => x.id === "planner")).toBe(false);
    expect(l.signage.find((g) => g.key === "planner")?.text).toBe("Planner · finished");
  });

  it("keeps the planner's signage inside the gutter, dropping a status that won't fit", () => {
    const long = layoutSquadMap(
      input([task("a", "backend")], { plannerLabel: "has been quiet for a while" }),
      frame,
    );
    expect(long.signage.find((g) => g.key === "planner")?.text).toBe("Planner");
  });

  it("keeps at least 12px between titles on the same row", () => {
    const titles = ["Scaffold the API", "Todo API contract", "Todo storage", "Todo routes"];
    for (const w of [700, 1000, 1440]) {
      const many = titles.map((title, i) =>
        task(`t${i}`, "backend", {
          title,
          status: i < 2 ? "done" : i === 2 ? "running" : "pending",
        }),
      );
      // An orb and its signage take the room right under the line, as in a live squad.
      const l = layoutSquadMap(
        input(many, { heads: { backend: { label: "has been quiet for a while", held: false } } }),
        { w, h: 500 },
      );
      expect(sameRowGaps(l).every((g) => g >= TITLE_GAP - 0.01)).toBe(true);
    }
  });

  it("keeps the gap in the run fixture's map, at 1440 and at 960", () => {
    const { state } = squadFixture("run");
    const view = squadView(state, state.squads[SQ]!);
    for (const w of [868, 600]) {
      const l = layoutSquadMap(
        input(
          view.tasks.map((x) => ({
            id: x.task.id,
            role: x.role,
            title: x.task.title,
            status: x.status,
            foundation: Boolean(x.task.foundation),
            ...(x.merge ? { merge: x.merge.state } : {}),
          })),
          {
            roles: view.roles.map((r) => ({
              id: r.id,
              colorKey: r.colorKey,
              name: r.name,
              code: r.code,
            })),
            heads: {
              backend: { label: "has been quiet for a while", held: false },
              frontend: { label: "is editing App.tsx", held: false },
            },
          },
        ),
        { w, h: 760 },
      );
      expect(sameRowGaps(l).every((g) => g >= TITLE_GAP - 0.01)).toBe(true);
      // No title lands on signage either.
      for (const st of l.stations)
        st.label.lines.forEach((line, i) => {
          const y = st.label.y + i * 13;
          const half = (line.length * SIGN_CHAR_W) / 2;
          for (const g of l.signage) {
            const gw = g.text.length * SIGN_CHAR_W;
            const gx = g.anchor === "end" ? g.x - gw : g.anchor === "middle" ? g.x - gw / 2 : g.x;
            const hit =
              Math.abs(g.y - y) < 11 && st.label.x + half > gx && st.label.x - half < gx + gw;
            expect([st.taskId, g.key, hit]).toEqual([st.taskId, g.key, false]);
          }
        });
    }
  });

  it("never puts a title under an orb riding the line", () => {
    const l = layoutSquadMap(
      input(
        [
          task("a", "backend", { status: "done", title: "Scaffold" }),
          task("b", "backend", { status: "running", title: "Todo storage" }),
          task("c", "backend", { title: "Todo routes" }),
        ],
        { heads: { backend: { label: "is editing app.ts", held: false } } },
      ),
      { w: 700, h: 500 },
    );
    const head = l.heads[0];
    for (const s of l.stations) {
      const half = (Math.max(...s.label.lines.map((x) => x.length)) * 6.4) / 2;
      const y2 = s.label.y + (s.label.lines.length - 1) * 13;
      const overlaps =
        s.label.x + half > (head?.cx ?? 0) - 15 &&
        s.label.x - half < (head?.cx ?? 0) + 15 &&
        y2 > (head?.cy ?? 0) - 19 &&
        s.label.y - 11 < (head?.cy ?? 0) + 19;
      expect([s.taskId, overlaps]).toEqual([s.taskId, false]);
    }
  });

  it("dims every line but the selected role's", () => {
    const l = layoutSquadMap(
      input([task("a", "backend"), task("b", "frontend")], { selectedRoleId: "frontend" }),
      frame,
    );
    expect(l.lines.map((x) => [x.id, x.dimmed])).toEqual([
      ["backend", true],
      ["frontend", false],
    ]);
  });
});
