import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrayStatus } from "@/infrastructure/platform/tray";
import { syncWithEngine } from "@/state/engineSync";
import { createAppStore } from "@/state/store";
import { ago, ev, NOW, started } from "@/test/events";
import { FakeGateway } from "@/test/FakeGateway";
import { startTraySync, stoppedAllNotice, TRAY_DEBOUNCE_MS } from "./traySync";

const at = (sessionId: string, agentId?: string) => ({
  ts: ago(0),
  projectId: "p1",
  sessionId,
  ...(agentId ? { agentId } : {}),
});

function setup() {
  const gateway = new FakeGateway();
  const store = createAppStore(gateway, { now: NOW });
  syncWithEngine(store, gateway);
  const sent: TrayStatus[] = [];
  const update = vi.fn(async (s: TrayStatus) => {
    sent.push(s);
  });
  let lang = "en";
  const localeListeners = new Set<() => void>();
  const locale = {
    get: () => lang,
    subscribe: (l: () => void) => {
      localeListeners.add(l);
      return () => localeListeners.delete(l);
    },
    set(next: string) {
      lang = next;
      for (const l of localeListeners) l();
    },
  };
  const stop = startTraySync({ store, tray: { update }, locale });
  const push = (...events: Parameters<typeof ev>[]) =>
    gateway.emitEvents({ seq: 1, events: events.map((args) => ev(...args)) });
  return { store, gateway, update, sent, locale, stop, push };
}

beforeEach(() => vi.useFakeTimers({ now: NOW }));
afterEach(() => vi.useRealTimers());

describe("tray sync", () => {
  it("sends the counts once things settle, then only when they change", async () => {
    const { gateway, update, sent, store } = setup();
    await vi.advanceTimersByTimeAsync(TRAY_DEBOUNCE_MS);
    expect(sent).toEqual([{ running: 0, waiting: 0, controllable: 0, locale: "en" }]);

    gateway.emitEvents({
      seq: 1,
      events: [
        ...started("s", 0, "p1", "chat"),
        ev("session.presence", { status: "busy" }, at("s")),
        ev("session.control", { controllable: true }, at("s")),
      ],
    });
    gateway.emitEvents({
      seq: 2,
      events: [
        ev(
          "permission.requested",
          { requestId: "r", toolName: "Bash", inputPreview: "ls" },
          at("s", "main"),
        ),
      ],
    });
    expect(update).toHaveBeenCalledTimes(1); // still inside the window
    await vi.advanceTimersByTimeAsync(TRAY_DEBOUNCE_MS);
    expect(sent.at(-1)).toEqual({ running: 0, waiting: 1, controllable: 1, locale: "en" });
    expect(update).toHaveBeenCalledTimes(2);

    // The clock ticks every second; unchanged numbers aren't sent again.
    store.getState().tick(NOW + 1000);
    store.getState().tick(NOW + 2000);
    await vi.advanceTimersByTimeAsync(TRAY_DEBOUNCE_MS * 2);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("follows the UI language", async () => {
    const { locale, sent } = setup();
    await vi.advanceTimersByTimeAsync(TRAY_DEBOUNCE_MS);
    locale.set("pt-BR");
    await vi.advanceTimersByTimeAsync(TRAY_DEBOUNCE_MS);
    expect(sent.map((s) => s.locale)).toEqual(["en", "pt-BR"]);
  });

  it("retries after a failed update", async () => {
    const { update, store } = setup();
    update.mockRejectedValueOnce(new Error("no tray"));
    await vi.advanceTimersByTimeAsync(TRAY_DEBOUNCE_MS);
    store.getState().tick(NOW + 1000); // same numbers, but the last send failed
    await vi.advanceTimersByTimeAsync(TRAY_DEBOUNCE_MS);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("stops sending when stopped", async () => {
    const { update, stop } = setup();
    stop();
    await vi.advanceTimersByTimeAsync(TRAY_DEBOUNCE_MS);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("stoppedAllNotice", () => {
  it("says what the kill switch did", () => {
    expect(stoppedAllNotice({ stopped: 3 })).toEqual({
      key: "notice.stopped",
      params: { count: 3 },
    });
    expect(stoppedAllNotice({ stopped: 0 })).toEqual({ key: "notice.stoppedNone" });
    expect(stoppedAllNotice({ error: "refused" })).toEqual({ key: "notice.stopFailed" });
  });
});
