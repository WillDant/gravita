import type { Ctx2D, OrbitAgent, OrbitInput, OrbitPath, VisibilitySource } from "../src";

/** A Ctx2D that records what was drawn, with the style in force at each fill/stroke/text. */
export class RecordingCtx implements Ctx2D {
  fillStyle: unknown = "#000";
  strokeStyle: unknown = "#000";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  globalAlpha = 1;
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  readonly ops: { op: string; style?: unknown; alpha?: number; args?: unknown[] }[] = [];
  private stack: unknown[][] = [];
  /** Only counts calls when false: keeps the bench honest about painter cost. */
  constructor(private readonly record = true) {}

  private log(op: string, extra: { style?: unknown; args?: unknown[] } = {}) {
    if (this.record) this.ops.push({ op, alpha: this.globalAlpha, ...extra });
  }
  save() {
    this.stack.push([this.fillStyle, this.strokeStyle, this.lineWidth, this.globalAlpha]);
  }
  restore() {
    const s = this.stack.pop();
    if (s) [this.fillStyle, this.strokeStyle, this.lineWidth, this.globalAlpha] = s as never;
  }
  setTransform() {}
  translate() {}
  scale() {}
  rotate() {}
  clearRect() {
    this.log("clear");
  }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  arc(...args: number[]) {
    this.log("arc", { args });
  }
  ellipse(...args: number[]) {
    this.log("ellipse", { args });
  }
  fill() {
    this.log("fill", { style: this.fillStyle });
  }
  stroke(path?: OrbitPath) {
    this.log(path ? "strokePath" : "stroke", { style: this.strokeStyle });
  }
  fillText(text: string) {
    this.log("text", { style: this.fillStyle, args: [text] });
  }
  measureText(text: string) {
    return { width: text.length * 6 };
  }
  count(op: string, style?: unknown) {
    return this.ops.filter((o) => o.op === op && (style === undefined || o.style === style)).length;
  }
  texts() {
    return this.ops.filter((o) => o.op === "text").map((o) => o.args?.[0]);
  }
}

export const fakePath = (d: string): OrbitPath => ({ d });

/** requestAnimationFrame, a clock and page visibility under the test's control. */
export class FakeEnv {
  t = 1_000_000;
  private queue = new Map<number, (ts: number) => void>();
  private nextId = 1;
  private listeners = new Set<() => void>();
  readonly visibility: VisibilitySource;
  hidden = false;

  constructor() {
    const self = this;
    this.visibility = {
      get hidden() {
        return self.hidden;
      },
      addEventListener: (_type, cb) => this.listeners.add(cb),
      removeEventListener: (_type, cb) => this.listeners.delete(cb),
    };
  }
  raf = (cb: (ts: number) => void) => {
    const id = this.nextId++;
    this.queue.set(id, cb);
    return id;
  };
  cancelRaf = (id: number) => {
    this.queue.delete(id);
  };
  now = () => this.t;
  get pending() {
    return this.queue.size;
  }
  /** Advances one 60 Hz display frame, running whatever was scheduled. */
  frame(n = 1) {
    for (let i = 0; i < n; i++) {
      this.t += 1000 / 60;
      const due = [...this.queue.values()];
      this.queue.clear();
      for (const cb of due) cb(this.t);
    }
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    for (const cb of this.listeners) cb();
  }
}

export const agent = (id: string, over: Partial<OrbitAgent> = {}): OrbitAgent => ({
  id,
  parentId: id === "main" ? null : "main",
  agentType: id === "main" ? "main" : "Explore",
  mood: "focused",
  lifecycle: "active",
  gaze: { kind: "tool", toolKind: "read" },
  glyph: "file",
  ...over,
});

export const orbit = (agents: OrbitAgent[]): OrbitInput => ({
  project: { id: "p1", name: "gravita" },
  agents,
});
