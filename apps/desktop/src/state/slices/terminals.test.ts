import type { TerminalInfo } from "@gravita/protocol";
import { describe, expect, it } from "vitest";
import { NOW } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { terminalOfSession } from "../hooks";
import { createAppStore } from "../store";

const term = (over: Partial<TerminalInfo>): TerminalInfo => ({
  terminalId: "t1",
  command: "claude",
  cwd: "/work/p1",
  projectId: "p1",
  startedAt: "2026-10-12T12:00:00.000Z",
  running: true,
  ...over,
});

describe("terminals slice", () => {
  it("follows the engine's updates and its own spawn and kill", async () => {
    const gateway = new FakeGateway();
    const store = createAppStore(gateway, { now: NOW });
    store.getState().applyTerminalUpdate({ terminal: term({ terminalId: "a" }) });
    expect(Object.keys(store.getState().terminals)).toEqual(["a"]);

    gateway.terminalInfo = term({ terminalId: "b", command: "shell" });
    const r = await store.getState().spawnTerminal({
      cwd: "/work/p1",
      command: "shell",
      cols: 80,
      rows: 24,
    });
    expect(r.ok).toBe(true);
    expect(Object.keys(store.getState().terminals).sort()).toEqual(["a", "b"]);

    await store.getState().killTerminal("a");
    expect(gateway.callsOf("killTerminal")).toEqual([{ terminalId: "a" }]);
    store.getState().applyTerminalUpdate({ closed: "b" });
    expect(store.getState().terminals).toEqual({});
  });

  it("loads the list on demand", async () => {
    const gateway = new FakeGateway();
    gateway.terminalsResult = { terminals: [term({ terminalId: "x" })] };
    const store = createAppStore(gateway, { now: NOW });
    store.getState().loadTerminals();
    await flush();
    expect(Object.keys(store.getState().terminals)).toEqual(["x"]);
  });

  it("picks a session's running terminal over an ended one", () => {
    const ended = term({ terminalId: "old", sessionId: "s", running: false });
    const live = term({
      terminalId: "new",
      sessionId: "s",
      startedAt: "2026-10-12T11:00:00.000Z",
    });
    expect(terminalOfSession({ old: ended, new: live }, "s")?.terminalId).toBe("new");
    expect(terminalOfSession({ old: ended }, "other")).toBeUndefined();
  });
});
