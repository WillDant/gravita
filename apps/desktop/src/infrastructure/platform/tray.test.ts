import { afterEach, describe, expect, it, vi } from "vitest";
import { STOPPED_ALL_EVENT, tauriTray } from "./tray";

const invoke = vi.fn(async (_cmd: string, _args?: unknown) => undefined);
const unlisten = vi.fn();
let emit: ((e: { payload: unknown }) => void) | undefined;
const listen = vi.fn(async (_event: string, handler: (e: { payload: unknown }) => void) => {
  emit = handler;
  return unlisten;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (e: { payload: unknown }) => void) => listen(event, handler),
}));

afterEach(() => {
  invoke.mockClear();
  listen.mockClear();
  unlisten.mockClear();
  emit = undefined;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Tauri tray", () => {
  it("hands the shell the counts and locale as tray_update's arguments", async () => {
    await tauriTray().update({ running: 3, waiting: 1, controllable: 2, locale: "pt-BR" });
    expect(invoke).toHaveBeenCalledWith("tray_update", {
      running: 3,
      waiting: 1,
      controllable: 2,
      locale: "pt-BR",
    });
  });

  it("relays the kill switch's result and unlistens", async () => {
    const results: unknown[] = [];
    const off = tauriTray().onStoppedAll((r) => results.push(r));
    await flush();
    expect(listen).toHaveBeenCalledWith(STOPPED_ALL_EVENT, expect.any(Function));
    emit?.({ payload: { stopped: 2 } });
    expect(results).toEqual([{ stopped: 2 }]);
    off();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("unlistens even when stopped before the listener was in place", async () => {
    const off = tauriTray().onStoppedAll(() => {});
    off();
    await flush();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
