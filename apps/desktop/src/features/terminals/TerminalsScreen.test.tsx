import type { EngineStatus, TerminalInfo } from "@gravita/protocol";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { paneIds } from "@/state/terminalLayout";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { TerminalsScreen } from "./TerminalsScreen";

vi.mock("@/features/terminal/TerminalPane", () => ({
  default: ({ terminalId }: { terminalId: string }) => <div data-testid={`xterm-${terminalId}`} />,
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);
setLocale("en");

const engine: EngineStatus = {
  providers: { claude: { found: true } },
  claude: { found: true },
  indexing: { done: 0, total: 0 },
  demo: false,
  terminal: true,
};

const term = (id: string, over: Partial<TerminalInfo> = {}): TerminalInfo => ({
  terminalId: id,
  command: "shell",
  cwd: "/Users/me",
  projectId: "home",
  startedAt: "2026-10-12T12:00:00.000Z",
  running: true,
  ...over,
});

describe("Terminals screen", () => {
  it("asks to open a terminal when none is on screen", async () => {
    const gateway = new FakeGateway();
    const { store } = renderWithApp(<TerminalsScreen />, { gateway });
    act(() => store.getState().setEngineStatus(engine));
    fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
    await act(flush);
    expect(await screen.findByTestId("xterm-t1")).toBeTruthy();
  });

  it("brings the terminal named by the address into view", () => {
    const { store } = renderWithApp(<TerminalsScreen terminalId="t2" />);
    act(() => {
      store.getState().applyTerminalUpdate({ terminal: term("t1") });
      store.getState().applyTerminalUpdate({ terminal: term("t2") });
    });
    expect(screen.getByTestId("xterm-t2")).toBeTruthy();
    expect(screen.queryByTestId("xterm-t1")).toBeNull();
    expect(store.getState().focusedTerminal).toBe("t2");
  });

  it("splits a terminal into a second one in the same folder, and the first keeps running", async () => {
    const gateway = new FakeGateway();
    const { store } = renderWithApp(<TerminalsScreen terminalId="t1" />, { gateway });
    act(() => store.getState().applyTerminalUpdate({ terminal: term("t1") }));
    const first = screen.getByTestId("xterm-t1");

    gateway.terminalInfo = term("t2");
    fireEvent.click(screen.getByRole("button", { name: "Split right" }));
    await act(flush);

    expect(screen.getByTestId("xterm-t2")).toBeTruthy();
    // Splitting did not remount the first terminal's view.
    expect(screen.getByTestId("xterm-t1")).toBe(first);
    expect(gateway.callsOf("spawnTerminal")[0]).toMatchObject({
      cwd: "/Users/me",
      command: "shell",
    });
    expect(paneIds(store.getState().terminalLayout)).toEqual(["t1", "t2"]);
    expect(store.getState().focusedTerminal).toBe("t2");
    expect(screen.getByRole("separator", { name: "Resize terminals" })).toBeTruthy();
  });

  it("gives the room back when a terminal closes", async () => {
    const { store } = renderWithApp(<TerminalsScreen terminalId="t1" />);
    act(() => {
      store.getState().applyTerminalUpdate({ terminal: term("t1") });
      store.getState().applyTerminalUpdate({ terminal: term("t2") });
      store.getState().placeTerminal("t2");
    });
    expect(screen.getByRole("separator")).toBeTruthy();
    act(() => store.getState().applyTerminalUpdate({ closed: "t2" }));
    expect(screen.queryByTestId("xterm-t2")).toBeNull();
    expect(screen.getByTestId("xterm-t1")).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("moves a divider with the arrow keys", () => {
    const { store } = renderWithApp(<TerminalsScreen terminalId="t1" />);
    act(() => {
      store.getState().applyTerminalUpdate({ terminal: term("t1") });
      store.getState().applyTerminalUpdate({ terminal: term("t2") });
      store.getState().placeTerminal("t2");
    });
    const bar = screen.getByRole("separator", { name: "Resize terminals" });
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(bar.getAttribute("aria-valuenow")).toBe("52");
  });
});
