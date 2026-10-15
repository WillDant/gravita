/**
 * How the open terminals are split on the Terminais screen: a binary tree whose leaves are
 * terminals and whose nodes cut their box in two, side by side (`row`) or one above the
 * other (`col`). Every function returns a new tree; none of them touches the engine.
 */
export type SplitDir = "row" | "col";

export type LayoutNode =
  | { kind: "pane"; terminalId: string }
  | { kind: "split"; dir: SplitDir; ratio: number; a: LayoutNode; b: LayoutNode };

/** `undefined`: no terminal is placed yet. */
export type Layout = LayoutNode | undefined;

export const MIN_RATIO = 0.15;
const clampRatio = (r: number) => Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, r));

export function paneIds(node: Layout): string[] {
  if (!node) return [];
  return node.kind === "pane" ? [node.terminalId] : [...paneIds(node.a), ...paneIds(node.b)];
}

export const hasPane = (node: Layout, terminalId: string) => paneIds(node).includes(terminalId);

/** The terminal's box becomes a split holding it and, after it, the new one. */
export function splitPane(
  node: LayoutNode,
  targetId: string,
  dir: SplitDir,
  newId: string,
): LayoutNode {
  if (node.kind === "pane") {
    return node.terminalId === targetId
      ? { kind: "split", dir, ratio: 0.5, a: node, b: { kind: "pane", terminalId: newId } }
      : node;
  }
  return {
    ...node,
    a: splitPane(node.a, targetId, dir, newId),
    b: splitPane(node.b, targetId, dir, newId),
  };
}

/** Takes a terminal out; its neighbour takes the room. */
export function removePane(node: Layout, terminalId: string): Layout {
  if (!node) return undefined;
  if (node.kind === "pane") return node.terminalId === terminalId ? undefined : node;
  const a = removePane(node.a, terminalId);
  const b = removePane(node.b, terminalId);
  if (a && b) return a === node.a && b === node.b ? node : { ...node, a, b };
  return a ?? b;
}

/** Keeps only the terminals that still exist. */
export function pruneLayout(node: Layout, keep: ReadonlySet<string>): Layout {
  let next = node;
  for (const id of paneIds(node)) if (!keep.has(id)) next = removePane(next, id);
  return next;
}

/** A restarted terminal takes the place of the one it replaces. */
export function replacePane(node: Layout, from: string, to: string): Layout {
  if (!node) return undefined;
  if (node.kind === "pane")
    return node.terminalId === from ? { kind: "pane", terminalId: to } : node;
  return {
    ...node,
    a: replacePane(node.a, from, to) as LayoutNode,
    b: replacePane(node.b, from, to) as LayoutNode,
  };
}

/**
 * Puts a terminal on screen if it isn't yet: first of all, else beside the focused one
 * (or the first one when nothing is focused).
 */
export function placeBeside(
  node: Layout,
  nextTo: string | undefined,
  terminalId: string,
): LayoutNode {
  const pane: LayoutNode = { kind: "pane", terminalId };
  if (!node) return pane;
  if (hasPane(node, terminalId)) return node;
  const anchor = nextTo && hasPane(node, nextTo) ? nextTo : (paneIds(node)[0] as string);
  return splitPane(node, anchor, "row", terminalId);
}

/** A divider is addressed by the path of `a`(0) / `b`(1) steps from the root to its split. */
export type SplitPath = readonly (0 | 1)[];

export function setRatio(node: Layout, path: SplitPath, ratio: number): Layout {
  if (!node || node.kind === "pane") return node;
  const [head, ...rest] = path;
  if (head === undefined) return { ...node, ratio: clampRatio(ratio) };
  return head === 0
    ? { ...node, a: setRatio(node.a, rest, ratio) as LayoutNode }
    : { ...node, b: setRatio(node.b, rest, ratio) as LayoutNode };
}

/** A box in fractions of the whole area (0 to 1). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Divider {
  path: SplitPath;
  dir: SplitDir;
  ratio: number;
  /** The box of the split this divider cuts. */
  box: Box;
}

/**
 * Where each terminal and each divider sit. The screen draws terminals as a flat list from
 * this, so splitting never remounts the ones already open.
 */
export function boxes(node: Layout): { panes: Map<string, Box>; dividers: Divider[] } {
  const panes = new Map<string, Box>();
  const dividers: Divider[] = [];
  const walk = (n: LayoutNode, box: Box, path: SplitPath) => {
    if (n.kind === "pane") {
      panes.set(n.terminalId, box);
      return;
    }
    dividers.push({ path, dir: n.dir, ratio: n.ratio, box });
    if (n.dir === "row") {
      const w = box.w * n.ratio;
      walk(n.a, { ...box, w }, [...path, 0]);
      walk(n.b, { ...box, x: box.x + w, w: box.w - w }, [...path, 1]);
    } else {
      const h = box.h * n.ratio;
      walk(n.a, { ...box, h }, [...path, 0]);
      walk(n.b, { ...box, y: box.y + h, h: box.h - h }, [...path, 1]);
    }
  };
  if (node) walk(node, { x: 0, y: 0, w: 1, h: 1 }, []);
  return { panes, dividers };
}

/** Reads a saved layout back; anything that doesn't fit the shape is dropped. */
export function parseLayout(raw: unknown): Layout {
  if (typeof raw !== "object" || raw === null) return undefined;
  const n = raw as Record<string, unknown>;
  if (n.kind === "pane") {
    return typeof n.terminalId === "string" && n.terminalId
      ? { kind: "pane", terminalId: n.terminalId }
      : undefined;
  }
  if (n.kind === "split" && (n.dir === "row" || n.dir === "col") && typeof n.ratio === "number") {
    const a = parseLayout(n.a);
    const b = parseLayout(n.b);
    if (a && b) return { kind: "split", dir: n.dir, ratio: clampRatio(n.ratio), a, b };
    return a ?? b;
  }
  return undefined;
}
