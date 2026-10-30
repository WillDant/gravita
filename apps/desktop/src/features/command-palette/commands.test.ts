import type { TerminalInfo } from "@gravita/protocol";
import { describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { ago, ev, NOW, started, stateOf } from "@/test/events";
import { buildCommands, type PaletteContext, paletteResults } from "./commands";

setLocale("en");

const p1 = { ts: ago(1), projectId: "p1", sessionId: "s1" };
const state = stateOf(
  started("s1", 5, "p1", "chat"),
  started("s2", 9, "p2", "chat"),
  started("s3", 7, "p2", "chat"),
  [
    ev("session.control", { controllable: true }, p1),
    ev(
      "permission.requested",
      { requestId: "r1", toolName: "Bash", inputPreview: "pnpm add jose" },
      { ...p1, agentId: "main" },
    ),
  ],
);

const terminal: TerminalInfo = {
  terminalId: "t1",
  command: "shell",
  cwd: "/work/p1",
  projectId: "p1",
  startedAt: "2026-10-12T12:00:00.000Z",
  running: true,
};

const ctx = (over: Partial<PaletteContext> = {}): PaletteContext => ({
  state,
  terminals: { t1: terminal },
  now: NOW,
  terminalsSupported: true,
  theme: "light",
  locale: "en",
  ...over,
});

describe("buildCommands", () => {
  it("puts an agent waiting for the user first, opening that agent", () => {
    const [first] = buildCommands(ctx());
    expect(first).toMatchObject({
      group: "needsYou",
      detail: "p1 · Waiting for you",
      target: {
        kind: "route",
        route: { level: "session", projectId: "p1", sessionId: "s1", agentId: "main" },
      },
    });
  });

  it("offers the theme and language the user isn't on", () => {
    const labels = buildCommands(ctx({ theme: "dark", locale: "en" })).map((c) => c.label);
    expect(labels).toContain("Switch to the light theme");
    expect(labels).toContain("Switch the language to Português");
  });

  it("leaves out terminals where the engine can't open them", () => {
    const groups = buildCommands(ctx({ terminalsSupported: false })).map((c) => c.id);
    expect(groups).not.toContain("action:newTerminal");
    expect(groups).not.toContain("terminal:t1");
  });
});

describe("paletteResults", () => {
  it("shows what needs you, the actions and the latest sessions before anything is typed", () => {
    const groups = paletteResults(buildCommands(ctx()), "");
    expect(groups.map((g) => g.group)).toEqual(["needsYou", "actions", "sessions"]);
    const sessions = groups.find((g) => g.group === "sessions")?.results ?? [];
    // Newest first: s1 (5 min ago), then s3 (7), then s2 (9).
    expect(sessions.map((r) => r.command.id)).toEqual(["session:s1", "session:s3", "session:s2"]);
  });

  it("searches every group once the user types, and highlights label matches", () => {
    const groups = paletteResults(buildCommands(ctx()), "p2");
    expect(groups.map((g) => g.group)).toEqual(["sessions", "projects"]);
    const project = groups.find((g) => g.group === "projects")?.results[0];
    expect(project?.command.id).toBe("project:p2");
    expect(project?.indices).toEqual([0, 1]);
  });

  it("finds actions by their hidden words, in either language", () => {
    const groups = paletteResults(buildCommands(ctx()), "escuro");
    expect(groups[0]?.results[0]?.command.id).toBe("action:toggleTheme");
  });
});
