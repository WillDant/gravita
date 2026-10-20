import type { ContextUsage } from "@gravita/protocol";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Session } from "@/features/session/Session";
import { setLocale } from "@/shared/i18n/i18n";
import { ev, started, stateOf } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});
setLocale("en");

const reply = (cacheRead: number, o: { model?: string; contextWindow?: number } = {}) =>
  ev(
    "usage.reported",
    { messageId: `m${cacheRead}`, input: 0, output: 0, cacheRead, cacheWrite: 0, ...o },
    { sessionId: "s1" },
  );

const USAGE: ContextUsage = {
  model: "claude-opus-5-5",
  totalTokens: 50_000,
  maxTokens: 200_000,
  percentage: 25,
  categories: [
    { name: "System prompt", tokens: 4_000, kind: "used" },
    { name: "Messages", tokens: 40_000, kind: "used" },
    { name: "MCP tools (deferred)", tokens: 9_000, kind: "deferred" },
    { name: "Autocompact buffer", tokens: 33_000, kind: "buffer" },
    { name: "Free space", tokens: 117_000, kind: "free" },
  ],
  memoryFiles: [{ path: "/work/p1/CLAUDE.md", type: "Project", tokens: 1_200 }],
  mcpTools: [
    { name: "mcp__linear__list_issues", serverName: "linear", tokens: 400, loaded: true },
    { name: "mcp__linear__create_issue", serverName: "linear", tokens: 600, loaded: false },
  ],
  agents: [],
  autoCompactThreshold: 167_000,
  autoCompact: true,
};

function render(events = [reply(84_000)], gateway = new FakeGateway()) {
  return renderWithApp(<Session projectId="p1" sessionId="s1" />, {
    state: stateOf(started("s1", 5, "p1"), events),
    gateway,
  });
}

describe("the context meter", () => {
  it("shows how much of the window the latest reply used", () => {
    render();
    expect(screen.getByRole("button", { name: "Context window: 42% used" })).toBeTruthy();
  });

  it("measures against the window the provider reported, and warns when nearly full", () => {
    render([reply(250_000, { contextWindow: 272_000 })]);
    const meter = screen.getByRole("button", { name: "Context window: 92% used" });
    expect(meter.className).toContain("text-waiting-ink");
  });

  it("measures against the window the turn reported (a 1M Claude chat)", () => {
    render([
      reply(84_000),
      ev("turn.completed", { contextWindow: 1_000_000 }, { sessionId: "s1" }),
    ]);
    expect(screen.getByRole("button", { name: "Context window: 8% used" })).toBeTruthy();
  });

  it("takes a session already past 200K for a 1M window", () => {
    render([reply(300_000)]);
    expect(screen.getByRole("button", { name: "Context window: 30% used" })).toBeTruthy();
  });

  it("is hidden before the first reply", () => {
    render([]);
    expect(screen.queryByRole("button", { name: /Context window/ })).toBeNull();
  });
});

describe("the context panel", () => {
  it("breaks the window down by category, MCP server and memory file", async () => {
    const gateway = new FakeGateway();
    gateway.sessionContextResult = { kind: "full", usage: USAGE };
    render(undefined, gateway);
    fireEvent.click(screen.getByRole("button", { name: /Context window/ }));
    await act(flush);

    const panel = within(screen.getByRole("dialog", { name: "Context" }));
    expect(gateway.callsOf("sessionContext")).toEqual([{ sessionId: "s1" }]);
    expect(panel.getByText("System prompt")).toBeTruthy();
    expect(panel.getByText("Free space")).toBeTruthy();
    expect(panel.getByText("Out of the window (loaded when used)")).toBeTruthy();
    expect(panel.getByText("MCP tools (deferred)")).toBeTruthy();
    expect(panel.getByText("Memory files · 1")).toBeTruthy();
    expect(panel.getByText("CLAUDE.md")).toBeTruthy();

    // A server's tools open under it, the deferred one marked.
    fireEvent.click(panel.getByRole("button", { name: /linear/ }));
    expect(panel.getByText("create_issue")).toBeTruthy();
    expect(panel.getByText("deferred")).toBeTruthy();
  });

  it("shows only the total for sessions Gravita doesn't run", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: /Context window/ }));
    await act(flush);
    const panel = within(screen.getByRole("dialog", { name: "Context" }));
    expect(panel.getByText("42%")).toBeTruthy();
    expect(panel.getByText(/only available for chats Gravita runs/)).toBeTruthy();
  });

  it("closes on Escape", async () => {
    render();
    fireEvent.click(screen.getByRole("button", { name: /Context window/ }));
    await act(flush);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Context" })).toBeNull();
  });
});
