import type { Line, LineMap, Station } from "@gravita/core";
import { describe, expect, it } from "vitest";
import {
  type AgentInfo,
  CHAR_W,
  COL_MAX,
  COL_MIN,
  DIM,
  fitText,
  LANE_MAX,
  LANE_MIN,
  type LayoutOptions,
  layoutLineMap,
  ORB,
  PAD_L,
} from "./geometry";

function station(agentId: string, col: number, extra: Partial<Station> = {}): Station {
  return {
    id: `${agentId}:${col}`,
    agentId,
    col,
    kind: "read",
    name: "Read",
    label: "app.ts",
    count: 1,
    toolUseIds: [`${agentId}:${col}`],
    status: "ok",
    startTs: "2026-10-12T12:00:00.000Z",
    ...extra,
  };
}

function line(agentId: string, lane: number, extra: Partial<Line> = {}): Line {
  return {
    agentId,
    parentId: agentId === "main" ? null : "main",
    depth: agentId === "main" ? 0 : 1,
    agentType: agentId === "main" ? "main" : "Explore",
    background: false,
    lane,
    startCol: 0,
    ended: false,
    stations: [],
    ...extra,
  };
}

const active: AgentInfo = { lifecycle: "active", label: "Reading app.ts" };

function opts(extra: Partial<LayoutOptions> = {}): LayoutOptions {
  return {
    live: true,
    agents: { main: active },
    texts: { main: "Main agent", hold: "On hold" },
    ...extra,
  };
}

const mainLine = (cols: number) =>
  line("main", 0, { stations: Array.from({ length: cols }, (_, c) => station("main", c)) });

describe("layoutLineMap: fitting the frame", () => {
  it("spreads columns and lanes to fill a roomy frame without scrolling", () => {
    const map: LineMap = {
      lines: [mainLine(10), line("sub", 1, { startCol: 2 })],
      cols: 10,
      lanes: 2,
    };
    const frame = { w: 1000, h: 400 };
    const layout = layoutLineMap(map, frame, opts({ agents: { main: active, sub: active } }));

    expect(layout.colW).toBeCloseTo((1000 - PAD_L - ORB - 64) / 10);
    expect(layout.colW).toBeLessThanOrEqual(COL_MAX);
    expect(layout.laneH).toBe(LANE_MAX);
    expect(layout.width).toBe(frame.w);
    expect(layout.height).toBe(frame.h);
    for (const s of layout.stations) expect(s.cx).toBeLessThan(layout.width);
    for (const h of layout.heads) expect(h.cx + ORB / 2).toBeLessThanOrEqual(layout.width);
  });

  it("clamps to the minimum column and lane, and grows past the frame to scroll", () => {
    const lines = [mainLine(200), ...Array.from({ length: 9 }, (_, i) => line(`s${i}`, i + 1))];
    const map: LineMap = { lines, cols: 200, lanes: 10 };
    const layout = layoutLineMap(map, { w: 1000, h: 400 }, opts());

    expect(layout.colW).toBe(COL_MIN);
    expect(layout.laneH).toBe(LANE_MIN);
    expect(layout.width).toBeGreaterThan(1000);
    expect(layout.height).toBeGreaterThan(400);
  });

  it("uses the widest column and the tightest lane before the frame is measured", () => {
    const layout = layoutLineMap(
      { lines: [mainLine(3)], cols: 3, lanes: 1 },
      { w: 0, h: 0 },
      opts(),
    );
    expect(layout.colW).toBe(COL_MAX);
    expect(layout.laneH).toBe(LANE_MIN);
  });

  it("draws the now rule only for a live session", () => {
    const map: LineMap = { lines: [mainLine(4)], cols: 4, lanes: 1 };
    const live = layoutLineMap(map, { w: 800, h: 300 }, opts());
    expect(live.now).toEqual({ x: live.x(4), y1: 22, y2: live.height - 8, labelY: 14 });
    expect(layoutLineMap(map, { w: 800, h: 300 }, opts({ live: false })).now).toBeUndefined();
  });

  it("dims every line but the selected agent's", () => {
    const map: LineMap = {
      lines: [mainLine(4), line("sub", 1, { startCol: 1 })],
      cols: 4,
      lanes: 2,
    };
    const layout = layoutLineMap(map, { w: 800, h: 300 }, opts({ selectedAgentId: "sub" }));
    expect(layout.paths.map((p) => [p.agentId, p.dimmed])).toEqual([
      ["main", true],
      ["sub", false],
    ]);
    expect(DIM).toBe(0.6);
  });
});

describe("layoutLineMap: line names", () => {
  const description = "Find every place auth tokens are read";
  const lateBranch = (desc: string) =>
    line("sub", 1, { startCol: 9, description: desc, stations: [station("sub", 9)] });

  it("slides a name left, whole, before it would run into the head orb", () => {
    const map: LineMap = { lines: [mainLine(10), lateBranch(description)], cols: 10, lanes: 2 };
    const layout = layoutLineMap(
      map,
      { w: 1000, h: 400 },
      opts({ agents: { main: active, sub: active } }),
    );
    const label = layout.labels.find((l) => l.agentId === "sub")!;
    const preferred = layout.x(9) + 12 + 6 + 4;

    expect(label.text).toBe(`Explore · ${description}`);
    expect(label.x).toBeLessThan(preferred);
  });

  it("stops a running line's name before the orb at its head", () => {
    const map: LineMap = { lines: [mainLine(10), lateBranch(description)], cols: 10, lanes: 2 };
    const layout = layoutLineMap(
      map,
      { w: 1000, h: 400 },
      opts({ agents: { main: active, sub: active } }),
    );
    for (const id of ["main", "sub"]) {
      const label = layout.labels.find((l) => l.agentId === id)!;
      const head = layout.heads.find((h) => h.agentId === id)!;
      expect(label.x + 21 + label.textW).toBeLessThanOrEqual(head.cx - ORB / 2 - 8 + 1e-9);
    }
  });

  it("truncates only when sliding all the way left still doesn't fit", () => {
    const long = "x".repeat(300);
    const map: LineMap = { lines: [mainLine(10), lateBranch(long)], cols: 10, lanes: 2 };
    const layout = layoutLineMap(
      map,
      { w: 1000, h: 400 },
      opts({ agents: { main: active, sub: active } }),
    );
    const label = layout.labels.find((l) => l.agentId === "sub")!;
    const head = layout.heads.find((h) => h.agentId === "sub")!;

    expect(label.x).toBe(PAD_L - 8);
    expect(label.text.endsWith("…")).toBe(true);
    expect(label.full).toBe(`Explore · ${long}`);
    expect(label.x + 21 + label.textW).toBeLessThanOrEqual(head.cx - ORB / 2 - 8);
  });

  it("names the main line with the translated word and shows its metro code", () => {
    const layout = layoutLineMap(
      { lines: [mainLine(2)], cols: 2, lanes: 1 },
      { w: 600, h: 200 },
      opts(),
    );
    expect(layout.labels[0]).toMatchObject({ text: "Main agent", code: "M" });
  });

  it("fitText keeps short text and ellipsizes long text within the width", () => {
    expect(fitText("Read", 100)).toBe("Read");
    const out = fitText("a".repeat(50), 66);
    expect(out).toBe(`${"a".repeat(9)}…`);
    expect(out.length * CHAR_W).toBeLessThanOrEqual(66);
  });
});

describe("layoutLineMap: signage and heads", () => {
  const map: LineMap = {
    lines: [
      mainLine(6),
      line("sub", 1, { startCol: 2, stations: [station("sub", 2)] }),
      line("done", 2, { startCol: 1, endCol: 3, ended: true, stations: [station("done", 1)] }),
    ],
    cols: 6,
    lanes: 3,
  };
  const agents: Record<string, AgentInfo> = {
    main: active,
    sub: { lifecycle: "waiting_user", label: "Waiting for you", askTool: "Bash" },
    done: { lifecycle: "done", label: "Done" },
  };

  it("reads the persona while running, and the hold with its tool while held", () => {
    const layout = layoutLineMap(map, { w: 900, h: 400 }, opts({ agents }));
    expect(layout.signage.map(({ agentId, text, held }) => ({ agentId, text, held }))).toEqual([
      { agentId: "main", text: "Reading app.ts", held: false },
      { agentId: "sub", text: "On hold · Bash", held: true },
    ]);
  });

  it("hangs each sign under its head orb, right-aligned to it", () => {
    const layout = layoutLineMap(map, { w: 900, h: 400 }, opts({ agents }));
    for (const sign of layout.signage) {
      const head = layout.heads.find((h) => h.agentId === sign.agentId)!;
      expect(sign.x).toBe(head.cx + ORB / 2);
      expect(sign.y).toBe(head.cy + ORB / 2 + 14);
    }
  });

  it("rides an orb only on running lines of agents that still have a node", () => {
    const layout = layoutLineMap(map, { w: 900, h: 400 }, opts({ agents: { main: active } }));
    expect(layout.heads.map((h) => h.agentId)).toEqual(["main"]);
  });

  it("leaves the last station's count to the signage on a running line", () => {
    const busy: LineMap = {
      lines: [
        line("main", 0, {
          stations: [station("main", 0, { count: 3 }), station("main", 1, { count: 2 })],
        }),
      ],
      cols: 2,
      lanes: 1,
    };
    const layout = layoutLineMap(busy, { w: 600, h: 200 }, opts());
    expect(layout.stations.map((s) => s.showCount)).toEqual([true, false]);
  });
});

describe("layoutLineMap: interchanges", () => {
  it("marks where a branch leaves its parent and where it merges back", () => {
    const map: LineMap = {
      lines: [
        mainLine(8),
        line("back", 1, { startCol: 2, endCol: 5, ended: true }),
        line("out", 2, { startCol: 6 }),
      ],
      cols: 8,
      lanes: 3,
    };
    const layout = layoutLineMap(map, { w: 900, h: 400 }, opts());
    const y0 = layout.y(0);
    expect(layout.interchanges.map(({ key, cx, cy }) => ({ key, cx, cy }))).toEqual([
      { key: "back:start", cx: layout.x(2), cy: y0 },
      { key: "back:end", cx: layout.x(5), cy: y0 },
      { key: "out:start", cx: layout.x(6), cy: y0 },
    ]);
  });

  it("links parallel spawns at consecutive columns into one connector", () => {
    const map: LineMap = {
      lines: [
        mainLine(8),
        line("a", 1, { startCol: 2 }),
        line("b", 2, { startCol: 3 }),
        line("c", 3, { startCol: 4 }),
      ],
      cols: 8,
      lanes: 4,
    };
    const layout = layoutLineMap(map, { w: 900, h: 400 }, opts());
    expect(layout.interchanges.map((i) => i.kind)).toEqual(["spawn", "spawn", "spawn"]);
    expect(layout.links).toEqual([
      { key: "a:start", x0: layout.x(2), x1: layout.x(4), cy: layout.y(0) },
    ]);
  });

  it("links merges in a row, but never a merge to a neighbouring spawn", () => {
    const map: LineMap = {
      lines: [
        mainLine(10),
        line("a", 1, { startCol: 1, endCol: 5, ended: true }),
        line("b", 2, { startCol: 3, endCol: 6, ended: true }),
        line("c", 1, { startCol: 7 }),
      ],
      cols: 10,
      lanes: 3,
    };
    const layout = layoutLineMap(map, { w: 900, h: 400 }, opts());
    // b merges at 6 and c spawns at 7: adjacent, but different events.
    expect(layout.links).toEqual([
      { key: "a:end", x0: layout.x(5), x1: layout.x(6), cy: layout.y(0) },
    ]);
  });

  it("keeps spawns apart when a column separates them, or when the parents differ", () => {
    const map: LineMap = {
      lines: [
        mainLine(10),
        line("a", 1, { startCol: 2 }),
        line("b", 2, { startCol: 4 }),
        line("n", 3, { startCol: 5, parentId: "b", depth: 2 }),
      ],
      cols: 10,
      lanes: 4,
    };
    const layout = layoutLineMap(map, { w: 900, h: 400 }, opts());
    expect(layout.interchanges).toHaveLength(3);
    expect(layout.links).toEqual([]);
  });

  it("routes branches octolinearly from the parent lane", () => {
    const map: LineMap = {
      lines: [mainLine(8), line("back", 1, { startCol: 2, endCol: 5, ended: true })],
      cols: 8,
      lanes: 2,
    };
    const layout = layoutLineMap(map, { w: 900, h: 400 }, opts());
    const { x, y } = layout;
    const branch = layout.paths.find((p) => p.agentId === "back")!;
    expect(branch.d).toBe(
      `M ${x(2)} ${y(0)} V ${y(1) - 12} L ${x(2) + 12} ${y(1)} H ${x(5) - 12} L ${x(5)} ${y(1) - 12} V ${y(0)}`,
    );
  });
});
