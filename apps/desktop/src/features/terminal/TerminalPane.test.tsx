import { act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";

// xterm needs a real layout engine; a stand-in records what the pane does with it.
const written: string[] = [];
let typed: ((data: string) => void) | undefined;
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 100;
    rows = 30;
    loadAddon() {}
    open() {}
    focus() {}
    write(data: string) {
      written.push(data);
    }
    onData(fn: (data: string) => void) {
      typed = fn;
      return { dispose() {} };
    }
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

const { default: TerminalPane } = await import("./TerminalPane");

afterEach(() => {
  cleanup();
  written.length = 0;
});
setLocale("en");

describe("TerminalPane", () => {
  it("shows what was printed, then the live stream, and sends keystrokes back", async () => {
    const gateway = new FakeGateway();
    gateway.scrollback = "$ ls\r\n";
    gateway.held.add("attachTerminal");
    renderWithApp(<TerminalPane terminalId="t1" />, { gateway });

    // Printed before the attach answered: already part of its scrollback.
    gateway.emitTerminalOutput({ terminalId: "t1", data: "$ ls\r\n" });
    gateway.release();
    await act(flush);
    gateway.emitTerminalOutput({ terminalId: "t1", data: "README.md\r\n" });
    gateway.emitTerminalOutput({ terminalId: "other", data: "nope" });
    expect(written).toEqual(["$ ls\r\n", "README.md\r\n"]);

    act(() => typed?.("pwd\r"));
    expect(gateway.callsOf("writeTerminal")).toEqual([{ terminalId: "t1", data: "pwd\r" }]);
  });
});
