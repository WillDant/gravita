import { describe, expect, it } from "vitest";
import {
  boxes,
  type Layout,
  type LayoutNode,
  paneIds,
  parseLayout,
  placeBeside,
  pruneLayout,
  removePane,
  replacePane,
  setRatio,
  splitPane,
} from "./terminalLayout";

const pane = (terminalId: string): LayoutNode => ({ kind: "pane", terminalId });

describe("terminal layout", () => {
  it("splits a terminal's box in two, the new one after it", () => {
    const tree = splitPane(pane("a"), "a", "row", "b");
    expect(tree).toEqual({ kind: "split", dir: "row", ratio: 0.5, a: pane("a"), b: pane("b") });
    const deeper = splitPane(tree, "b", "col", "c");
    expect(paneIds(deeper)).toEqual(["a", "b", "c"]);
  });

  it("gives the room back to the neighbour when a terminal goes", () => {
    const tree = splitPane(splitPane(pane("a"), "a", "row", "b"), "b", "col", "c");
    expect(paneIds(removePane(tree, "b"))).toEqual(["a", "c"]);
    expect(removePane(splitPane(pane("a"), "a", "row", "b"), "a")).toEqual(pane("b"));
    expect(removePane(pane("a"), "a")).toBeUndefined();
  });

  it("keeps only the terminals that still exist", () => {
    const tree = splitPane(splitPane(pane("a"), "a", "row", "b"), "b", "col", "c");
    expect(paneIds(pruneLayout(tree, new Set(["a", "c"])))).toEqual(["a", "c"]);
    expect(pruneLayout(tree, new Set())).toBeUndefined();
  });

  it("places a new terminal beside the focused one, once", () => {
    expect(placeBeside(undefined, undefined, "a")).toEqual(pane("a"));
    const two = placeBeside(pane("a"), "a", "b");
    expect(paneIds(two)).toEqual(["a", "b"]);
    expect(placeBeside(two, "a", "b")).toBe(two);
    const three = placeBeside(two, "b", "c");
    expect(paneIds(three)).toEqual(["a", "b", "c"]);
  });

  it("swaps a restarted terminal into the old one's place", () => {
    const tree = splitPane(pane("a"), "a", "row", "b");
    expect(paneIds(replacePane(tree, "a", "z"))).toEqual(["z", "b"]);
  });

  it("clamps how far a divider can go", () => {
    const tree = splitPane(pane("a"), "a", "row", "b");
    expect((setRatio(tree, [], 0.01) as { ratio: number }).ratio).toBe(0.15);
    expect((setRatio(tree, [], 0.99) as { ratio: number }).ratio).toBe(0.85);
    expect((setRatio(tree, [], 0.3) as { ratio: number }).ratio).toBe(0.3);
  });

  it("lays boxes and dividers out as fractions of the area", () => {
    const tree = setRatio(
      splitPane(splitPane(pane("a"), "a", "row", "b"), "b", "col", "c"),
      [],
      0.4,
    ) as LayoutNode;
    const { panes, dividers } = boxes(tree);
    expect(panes.get("a")).toEqual({ x: 0, y: 0, w: 0.4, h: 1 });
    expect(panes.get("b")).toMatchObject({ x: 0.4, y: 0, h: 0.5 });
    expect(panes.get("b")?.w).toBeCloseTo(0.6);
    expect(panes.get("c")?.y).toBe(0.5);
    expect(dividers.map((d) => d.path)).toEqual([[], [1]]);
  });

  it("reads a saved layout and drops what doesn't fit", () => {
    const tree: Layout = splitPane(pane("a"), "a", "col", "b");
    expect(parseLayout(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
    expect(parseLayout("nope")).toBeUndefined();
    expect(parseLayout({ kind: "split", dir: "diagonal", ratio: 0.5 })).toBeUndefined();
    expect(parseLayout({ kind: "pane", terminalId: "" })).toBeUndefined();
  });
});
