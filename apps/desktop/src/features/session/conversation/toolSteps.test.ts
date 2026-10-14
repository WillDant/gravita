import type { ConversationMessage } from "@gravita/protocol";
import { describe, expect, it } from "vitest";
import { ago, ev } from "@/test/events";
import { BEFORE_FIRST, summarizeSteps, toolStepsByMessage } from "./toolSteps";

const at = (minutesAgo: number) => ({ ts: ago(minutesAgo), sessionId: "s" });
const msg = (uuid: string, minutesAgo: number): ConversationMessage => ({
  uuid,
  role: "assistant",
  ts: ago(minutesAgo),
  text: uuid,
});
const tool = (id: string, name: string, kind: "read" | "bash" | "agent", minutesAgo: number) =>
  ev(
    "tool.started",
    { toolUseId: id, name, kind, target: { path: `/w/${id}.ts` }, inputPreview: "" },
    at(minutesAgo),
  );

describe("toolStepsByMessage", () => {
  it("puts each call under the message it follows, and leaves spawns to the chips", () => {
    const events = [
      tool("t0", "Read", "read", 10),
      tool("t1", "Grep", "read", 8),
      tool("t2", "Bash", "bash", 7),
      tool("t3", "Agent", "agent", 6),
      tool("t4", "Bash", "bash", 3),
    ];
    const groups = toolStepsByMessage(events, [msg("a", 9), msg("b", 5)]);
    expect(groups.get(BEFORE_FIRST)?.map((s) => s.id)).toEqual(["t0"]);
    expect(groups.get("a")?.map((s) => s.id)).toEqual(["t1", "t2"]);
    expect(groups.get("b")?.map((s) => s.id)).toEqual(["t4"]);
  });
});

describe("summarizeSteps", () => {
  it("counts calls per kind in the order kinds first appear", () => {
    const groups = toolStepsByMessage(
      [
        tool("t1", "Bash", "bash", 4),
        tool("t2", "Read", "read", 3),
        tool("t3", "Grep", "read", 2),
        tool("t4", "Bash", "bash", 1),
      ],
      [],
    );
    const summary = summarizeSteps(groups.get(BEFORE_FIRST) ?? []);
    expect(summary.map(({ kind, count }) => ({ kind, count }))).toEqual([
      { kind: "bash", count: 2 },
      { kind: "read", count: 2 },
    ]);
    expect(summary[0]?.target).toBe("t1.ts");
  });
});
