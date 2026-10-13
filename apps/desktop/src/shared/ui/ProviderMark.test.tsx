import type { GravitaEvent } from "@gravita/protocol";
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Project } from "@/features/project/Project";
import { Session } from "@/features/session/Session";
import { setLocale } from "@/shared/i18n/i18n";
import { ago, ev, started, stateOf } from "@/test/events";
import { flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";

afterEach(cleanup);
setLocale("en");
// The session screen draws the line map, which measures its frame (jsdom has no layout).
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

const CODEX = "codex:019cf4f0-977f-7e41-9672-55468e49cc0c";
const CLAUDE = "5f0c2b8e-claude";

/** Events as `provider` sends them. */
const from = (provider: "claude" | "codex", events: GravitaEvent[]) =>
  events.map((e) => ({ ...e, provider }));

const titled = (sessionId: string, title: string) =>
  ev("session.titled", { title }, { ts: ago(4), projectId: "p1", sessionId });

const state = stateOf(
  from("claude", [...started(CLAUDE, 6, "p1"), titled(CLAUDE, "Fix the login form")]),
  from("codex", [...started(CODEX, 5, "p1"), titled(CODEX, "Speed up the build")]),
);

const mark = { name: "Codex session" };

describe("provider mark", () => {
  it("marks a Codex session's row and leaves Claude Code's unmarked", async () => {
    renderWithApp(<Project projectId="p1" />, { state });
    await act(flush);
    const rows = screen.getAllByRole("row").slice(1);
    const codex = rows.find((r) => r.textContent?.includes("Speed up the build"));
    const claude = rows.find((r) => r.textContent?.includes("Fix the login form"));
    expect(within(codex as HTMLElement).getByRole("img", mark).textContent).toBe("Codex");
    expect(within(claude as HTMLElement).queryByRole("img", mark)).toBeNull();
  });

  it("names a Codex session in the breadcrumb and the agent panel", async () => {
    renderWithApp(<Session projectId="p1" sessionId={CODEX} agentId="main" />, { state });
    await act(flush);
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("img", mark)).toBeTruthy();
    const panel = screen.getByRole("heading", { name: "Main agent" }).parentElement;
    expect(within(panel as HTMLElement).getByRole("img", mark)).toBeTruthy();
  });

  it("puts no mark on a Claude Code session", async () => {
    renderWithApp(<Session projectId="p1" sessionId={CLAUDE} agentId="main" />, { state });
    await act(flush);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain(
      "Fix the login form",
    );
    expect(screen.queryByRole("img", mark)).toBeNull();
  });
});
