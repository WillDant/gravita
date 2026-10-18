import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import FileEditor from "./FileEditor";
import type { OpenFile } from "./openFiles";

afterEach(cleanup);
setLocale("en");

const file = (path: string, text: string): OpenFile => ({
  path,
  status: "text",
  text,
  saved: text,
  mtimeMs: 1,
});

const noop = () => {};
const editor = (f: OpenFile) => (
  <StrictMode>
    <FileEditor file={f} onChange={noop} onSave={noop} onReload={noop} onOverwrite={noop} />
  </StrictMode>
);
const content = (c: HTMLElement) => c.querySelector(".cm-content")?.textContent;

describe("FileEditor", () => {
  it("shows the file the first time it opens, through StrictMode's remount", () => {
    const { container } = render(editor(file("a.txt", "hello")));
    expect(content(container)).toBe("hello");
  });

  it("shows a file that arrives after loading", () => {
    const { container, rerender } = render(editor({ path: "a.txt", status: "loading" }));
    rerender(editor(file("a.txt", "loaded")));
    expect(content(container)).toBe("loaded");
  });

  it("switches between files", () => {
    const { container, rerender } = render(editor(file("a.txt", "one")));
    rerender(editor(file("b.txt", "two")));
    expect(content(container)).toBe("two");
    rerender(editor(file("a.txt", "one")));
    expect(content(container)).toBe("one");
  });
});
