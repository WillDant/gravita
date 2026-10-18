import type { TerminalInfo } from "@gravita/protocol";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Session } from "@/features/session/Session";
import { setLocale } from "@/shared/i18n/i18n";
import { started, stateOf } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import type { OpenFile } from "./openFiles";
import { resetOpenFiles } from "./openFiles";

// CodeMirror needs a real layout engine; a textarea stands in for it.
vi.mock("./FileEditor", () => ({
  default: ({
    file,
    onChange,
    onSave,
  }: {
    file: OpenFile;
    onChange: (text: string) => void;
    onSave: () => void;
  }) =>
    file.status === "text" ? (
      <textarea
        aria-label={`editor ${file.path}`}
        value={file.text}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "s" && e.metaKey) onSave();
        }}
      />
    ) : (
      <p>{file.status}</p>
    ),
}));
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
afterEach(() => {
  cleanup();
  resetOpenFiles();
  localStorage.clear();
});
setLocale("en");

const term: TerminalInfo = {
  terminalId: "t1",
  command: "claude",
  cwd: "/work/p1",
  projectId: "p1",
  sessionId: "s1",
  startedAt: "2026-10-12T12:00:00.000Z",
  running: true,
};

async function setup() {
  const gateway = new FakeGateway();
  gateway.files = { "README.md": "# hi", "src/app.ts": "const a = 1;" };
  const view = renderWithApp(<Session projectId="p1" sessionId="s1" />, {
    state: stateOf(started("s1", 5, "p1")),
    gateway,
  });
  act(() => view.store.getState().applyTerminalUpdate({ terminal: term }));
  await act(flush);
  return view;
}

const tab = (name: string | RegExp) => screen.getByRole("tab", { name });

describe("the file explorer", () => {
  it("replaces the map and opens a file in place of the terminal", async () => {
    const { gateway } = await setup();
    expect(screen.queryByRole("tab", { name: "File" })).toBeNull();
    expect(tab("Lines")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show files" }));
    await act(flush);
    expect(screen.queryByRole("tab", { name: "Lines" })).toBeNull();
    expect(screen.getByRole("treeitem", { name: "README.md" })).toBeTruthy();

    // A folder lists its files when opened.
    fireEvent.click(screen.getByRole("treeitem", { name: "src" }));
    await act(flush);
    fireEvent.click(screen.getByRole("treeitem", { name: "app.ts" }));
    await act(flush);

    expect(tab("File").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("xterm-t1")).toBeNull();
    expect(screen.getByLabelText<HTMLTextAreaElement>("editor src/app.ts").value).toBe(
      "const a = 1;",
    );
    expect(gateway.callsOf("fsRead")).toEqual([{ root: "/work/p1", path: "src/app.ts" }]);

    fireEvent.click(tab("Terminal"));
    expect(await screen.findByTestId("xterm-t1")).toBeTruthy();
  });

  it("marks a changed file until it is saved, then closes it back to the terminal", async () => {
    const { gateway } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Show files" }));
    await act(flush);
    fireEvent.click(screen.getByRole("treeitem", { name: "README.md" }));
    await act(flush);

    const editor = screen.getByLabelText("editor README.md");
    fireEvent.change(editor, { target: { value: "# changed" } });
    expect(tab(/^README\.md\s*\(unsaved\)$/)).toBeTruthy();

    fireEvent.keyDown(editor, { key: "s", metaKey: true });
    await act(flush);
    expect(gateway.files["README.md"]).toBe("# changed");
    expect(gateway.callsOf("fsWrite")).toEqual([
      { root: "/work/p1", path: "README.md", text: "# changed", expectedMtimeMs: 1 },
    ]);
    expect(tab("README.md")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /unsaved/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close README.md" }));
    expect(screen.queryByRole("tab", { name: "File" })).toBeNull();
    expect(tab("Terminal").getAttribute("aria-selected")).toBe("true");
  });

  it("asks before closing a tab with unsaved changes", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Show files" }));
    await act(flush);
    fireEvent.click(screen.getByRole("treeitem", { name: "README.md" }));
    await act(flush);
    fireEvent.change(screen.getByLabelText("editor README.md"), { target: { value: "x" } });

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Close README.md" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(tab(/^README\.md\s*\(unsaved\)$/)).toBeTruthy();
    confirm.mockRestore();
  });
});
