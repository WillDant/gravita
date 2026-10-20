import type { EngineStatus, TerminalInfo } from "@gravita/protocol";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { started, stateOf } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { Sidebar } from "./Sidebar";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
setLocale("en");

const state = stateOf(started("s1", 5, "p1"));

describe("Sidebar", () => {
  it("keeps Home on its own at the top, ahead of the projects", async () => {
    renderWithApp(<Sidebar />, { state });
    await act(flush);
    const nav = screen.getByRole("navigation", { name: "Gravita" });
    const home = screen.getByRole("button", { name: "Home" });
    const heading = screen.getByText("Projects");
    // Home comes before the Projects heading, and nothing else sits between them and the top.
    expect(home.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.contains(home)).toBe(true);
    expect(home.className).toContain("font-semibold");
    expect(screen.queryByRole("button", { name: "Needs you" })).toBeNull();
  });

  it("opens the new-session screen from the + next to Projects", async () => {
    const { navigate } = renderWithApp(<Sidebar />, { state });
    await act(flush);
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(navigate).toHaveBeenCalledWith({ level: "home", newSession: true });
  });

  it("keeps only Settings and Notifications in the footer, and opens Settings", async () => {
    const { navigate } = renderWithApp(<Sidebar />, { state });
    await act(flush);
    const settings = screen.getByRole("button", { name: "Settings" });
    const heading = screen.getByText("Projects");
    const notifications = screen.getByRole("button", { name: /notif/i });
    expect(
      heading.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(settings.parentElement?.contains(notifications)).toBe(true);
    expect(screen.queryByRole("button", { name: /theme/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(EN|PT)$/ })).toBeNull();
    fireEvent.click(settings);
    expect(navigate).toHaveBeenCalledWith({ level: "settings" });
  });
});

const engine: EngineStatus = {
  providers: { claude: { found: true } },
  claude: { found: true },
  indexing: { done: 0, total: 0 },
  demo: false,
  terminal: true,
};

const term = (over: Partial<TerminalInfo> = {}): TerminalInfo => ({
  terminalId: "t1",
  command: "shell",
  cwd: "/Users/me",
  projectId: "home",
  startedAt: "2026-10-12T12:00:00.000Z",
  running: true,
  ...over,
});

describe("Sidebar: terminals", () => {
  it("offers New terminal right under Home, and opens a shell in the home folder", async () => {
    const gateway = new FakeGateway();
    const { store, navigate } = renderWithApp(<Sidebar />, { state, gateway });
    act(() => store.getState().setEngineStatus(engine));
    const home = screen.getByRole("button", { name: "Home" });
    const open = screen.getByRole("button", { name: "New terminal" });
    expect(home.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(open.compareDocumentPosition(screen.getByText("Projects"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    fireEvent.click(open);
    await act(flush);
    const [call] = gateway.callsOf("spawnTerminal");
    expect(call).toMatchObject({ command: "shell" });
    expect(call).not.toHaveProperty("cwd");
    expect(navigate).toHaveBeenCalledWith({ level: "terminals", terminalId: "t1" });
    expect(store.getState().focusedTerminal).toBe("t1");
  });

  it("adds a terminal from the + beside Terminals, even before there is one", async () => {
    const gateway = new FakeGateway();
    const { store, navigate } = renderWithApp(<Sidebar />, { state, gateway });
    act(() => store.getState().setEngineStatus(engine));
    expect(screen.getByText("Terminals")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add terminal" }));
    await act(flush);
    expect(gateway.callsOf("spawnTerminal")).toHaveLength(1);
    expect(navigate).toHaveBeenCalledWith({ level: "terminals", terminalId: "t1" });
  });

  it("hides New terminal when the engine can't open terminals", async () => {
    const { store } = renderWithApp(<Sidebar />, { state });
    act(() => store.getState().setEngineStatus({ ...engine, terminal: false }));
    expect(screen.queryByRole("button", { name: "New terminal" })).toBeNull();
  });

  it("lists each terminal under Terminals, with the agent's icon when one runs", async () => {
    const { store, navigate } = renderWithApp(<Sidebar />, { state });
    act(() => {
      store.getState().setEngineStatus(engine);
      store.getState().applyTerminalUpdate({ terminal: term() });
      store.getState().applyTerminalUpdate({
        terminal: term({
          terminalId: "t2",
          activeProvider: "codex",
          startedAt: "2026-10-12T12:05:00.000Z",
        }),
      });
      store.getState().applyTerminalUpdate({
        terminal: term({
          terminalId: "t3",
          command: "cursor",
          startedAt: "2026-10-12T12:10:00.000Z",
        }),
      });
    });
    expect(screen.getByText("Terminals")).toBeTruthy();
    const rows = screen.getAllByTitle(/· me$/);
    expect(rows.map((r) => r.getAttribute("title"))).toEqual([
      "Shell · me",
      "Codex · me",
      "Cursor Agent · me",
    ]);
    // A plain shell wears the terminal icon; a shell running Codex and a Cursor terminal wear the agent's.
    const icons = rows.map((r) => r.querySelector("svg")?.getAttribute("class") ?? "");
    expect(icons[0]).toContain("lucide-square-terminal");
    expect(icons[1]).not.toContain("lucide");
    expect(icons[2]).not.toContain("lucide");

    fireEvent.click(rows[1] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith({ level: "terminals", terminalId: "t2" });
    expect(store.getState().focusedTerminal).toBe("t2");

    // Codex exits: the shell is back at its prompt, and the row says so.
    act(() =>
      store.getState().applyTerminalUpdate({
        terminal: term({ terminalId: "t2", startedAt: "2026-10-12T12:05:00.000Z" }),
      }),
    );
    expect(screen.getAllByTitle(/· me$/).map((r) => r.getAttribute("title"))).toEqual([
      "Shell · me",
      "Shell · me",
      "Cursor Agent · me",
    ]);
  });
});

describe("Sidebar: collapsing", () => {
  it("folds into the icon rail, with short bars for the group titles, and opens again", async () => {
    const { store } = renderWithApp(<Sidebar />, { state });
    act(() => {
      store.getState().setEngineStatus(engine);
      store.getState().applyTerminalUpdate({ terminal: term() });
    });
    expect(screen.getByText("Projects")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse menu" }));
    expect(screen.queryByText("Projects")).toBeNull();
    expect(screen.queryByText("Terminals")).toBeNull();
    expect(screen.queryByText("Gravita")).toBeNull();
    expect(screen.getByRole("separator", { name: "Projects" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Terminals" })).toBeTruthy();
    // Every row is still reachable by name, as an icon.
    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New terminal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^p1/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add terminal" })).toBeNull();
    expect(localStorage.getItem("gravita.sidebar.collapsed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Expand menu" }));
    expect(screen.getByText("Projects")).toBeTruthy();
    expect(localStorage.getItem("gravita.sidebar.collapsed")).toBe("false");
  });

  it("starts collapsed when the user left it that way", async () => {
    localStorage.setItem("gravita.sidebar.collapsed", "true");
    renderWithApp(<Sidebar />, { state });
    expect(screen.queryByText("Projects")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand menu" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("toggles with ⌘B", async () => {
    renderWithApp(<Sidebar />, { state });
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(screen.queryByText("Projects")).toBeNull();
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(screen.getByText("Projects")).toBeTruthy();
  });
});
