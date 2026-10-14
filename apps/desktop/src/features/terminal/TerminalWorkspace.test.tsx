import type { EngineStatus, TerminalInfo } from "@gravita/protocol";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NewSessionPanel } from "@/features/new-session/NewSessionPanel";
import { Session } from "@/features/session/Session";
import { setLocale } from "@/shared/i18n/i18n";
import { ev, started, stateOf } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { TerminalScreen } from "./TerminalScreen";

vi.mock("./TerminalPane", () => ({
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

const term = (over: Partial<TerminalInfo> = {}): TerminalInfo => ({
  terminalId: "t1",
  command: "claude",
  cwd: "/work/p1",
  projectId: "p1",
  sessionId: "s1",
  startedAt: "2026-10-12T12:00:00.000Z",
  running: true,
  ...over,
});

const engine: EngineStatus = {
  providers: { claude: { found: true } },
  claude: { found: true },
  indexing: { done: 0, total: 0 },
  demo: false,
  terminal: true,
};

describe("a session in a terminal", () => {
  it("talks through its terminal beside the map, with the conversation a tab away", async () => {
    const state = stateOf(started("s1", 5, "p1"));
    const { store } = renderWithApp(<Session projectId="p1" sessionId="s1" />, { state });
    act(() => store.getState().applyTerminalUpdate({ terminal: term() }));

    expect(await screen.findByTestId("xterm-t1")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: "Lines" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize the map" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Conversation" }));
    expect(screen.queryByTestId("xterm-t1")).toBeNull();
  });

  it("shows a terminal before its session has started, map waiting", async () => {
    const { store } = renderWithApp(<Session projectId="p1" sessionId="s-new" />);
    act(() => store.getState().applyTerminalUpdate({ terminal: term({ sessionId: "s-new" }) }));
    expect(await screen.findByTestId("xterm-t1")).toBeTruthy();
    expect(screen.getByText("The agents show up here once the session starts.")).toBeTruthy();
  });

  it("resumes the session once its process ended", async () => {
    const state = stateOf(started("s1", 5, "p1"));
    const { store, gateway } = renderWithApp(<Session projectId="p1" sessionId="s1" />, {
      state,
    });
    act(() =>
      store.getState().applyTerminalUpdate({ terminal: term({ running: false, exitCode: 0 }) }),
    );
    expect(screen.getByRole("status").textContent).toContain("The process ended with code 0.");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume the session" }));
      await flush();
    });
    expect(gateway.callsOf("spawnTerminal")).toEqual([
      expect.objectContaining({ cwd: "/work/p1", command: "claude", resume: "s1" }),
    ]);
  });

  it("asks before closing a terminal that still runs", async () => {
    const state = stateOf(started("s1", 5, "p1"));
    const { store, gateway } = renderWithApp(<Session projectId="p1" sessionId="s1" />, {
      state,
    });
    act(() => store.getState().applyTerminalUpdate({ terminal: term() }));
    fireEvent.click(screen.getByRole("button", { name: "Close terminal" }));
    expect(gateway.callsOf("killTerminal")).toEqual([]);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Close this terminal? What runs in it stops." }),
      );
      await flush();
    });
    expect(gateway.callsOf("killTerminal")).toEqual([{ terminalId: "t1" }]);
  });

  it("offers to continue an observed session that no longer runs", async () => {
    const state = stateOf(started("s1", 5, "p1"), [
      ev("session.ended", { reason: "exit" }, { sessionId: "s1", projectId: "p1" }),
    ]);
    const { store, gateway } = renderWithApp(<Session projectId="p1" sessionId="s1" />, {
      state,
    });
    act(() => store.getState().setEngineStatus(engine));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue in a terminal" }));
      await flush();
    });
    expect(gateway.callsOf("spawnTerminal")).toEqual([
      expect.objectContaining({ command: "claude", resume: "s1", cwd: "/work/p1" }),
    ]);
  });
});

describe("a terminal's own screen", () => {
  it("moves to the session's screen once a session starts in it", () => {
    const { store, navigate } = renderWithApp(<TerminalScreen projectId="p1" terminalId="t1" />);
    act(() =>
      store
        .getState()
        .applyTerminalUpdate({ terminal: term({ command: "shell", sessionId: undefined }) }),
    );
    expect(navigate).not.toHaveBeenCalled();
    act(() =>
      store
        .getState()
        .applyTerminalUpdate({ terminal: term({ command: "shell", sessionId: "s9" }) }),
    );
    expect(navigate).toHaveBeenCalledWith({ level: "session", projectId: "p1", sessionId: "s9" });
  });
});

describe("starting a session in a terminal", () => {
  it("is the first choice, takes no message, and opens the terminal", async () => {
    const gateway = new FakeGateway();
    gateway.terminalInfo = term({ command: "claude", sessionId: "s-t" });
    const { store, navigate } = renderWithApp(
      <NewSessionPanel id="ns" defaultFolder="/work/p1" onClose={() => {}} />,
      { gateway },
    );
    act(() => store.getState().setEngineStatus(engine));
    await act(flush);
    expect((screen.getByRole("radio", { name: "Terminal" }) as HTMLInputElement).checked).toBe(
      true,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start session" }));
      await flush();
    });
    expect(gateway.callsOf("spawnTerminal")).toEqual([
      expect.objectContaining({ cwd: "/work/p1", command: "claude", permissionMode: "default" }),
    ]);
    expect(gateway.callsOf("startSession")).toEqual([]);
    expect(navigate).toHaveBeenCalledWith({ level: "session", projectId: "p1", sessionId: "s-t" });
  });
});
