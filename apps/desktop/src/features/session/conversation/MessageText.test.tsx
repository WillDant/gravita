import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/app/providers";
import { createNotificationPrefs } from "@/infrastructure/preferences/notificationPrefs";
import { createProjectAppearance } from "@/infrastructure/preferences/projectAppearance";
import { createAppStore } from "@/state/store";
import { NOW } from "@/test/events";
import { FakeGateway } from "@/test/FakeGateway";
import { memoryStorage } from "@/test/render";
import { MessageText } from "./MessageText";
import { parseInline, parseMessage } from "./parseMessage";

afterEach(cleanup);

describe("parseMessage", () => {
  it("reads paragraphs, headings, lists, fenced code and inline runs", () => {
    const text = [
      "## Plan",
      "First **bold** and `code`.",
      "Second line.",
      "",
      "- one",
      "- two",
      "  continued",
      "",
      "3. three",
      "4. four",
      "```ts",
      "const a = `x`;",
      "",
      "```",
    ].join("\n");

    expect(parseMessage(text)).toEqual([
      { kind: "heading", inlines: [{ kind: "text", text: "Plan" }] },
      {
        kind: "paragraph",
        inlines: [
          { kind: "text", text: "First " },
          { kind: "strong", text: "bold" },
          { kind: "text", text: " and " },
          { kind: "code", text: "code" },
          { kind: "text", text: ".\nSecond line." },
        ],
      },
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two continued" }]],
      },
      {
        kind: "list",
        ordered: true,
        start: 3,
        items: [[{ kind: "text", text: "three" }], [{ kind: "text", text: "four" }]],
      },
      { kind: "code", lang: "ts", text: "const a = `x`;\n" },
    ]);
  });

  it("keeps an unclosed fence as code to the end", () => {
    expect(parseMessage("```\nrm -rf x")).toEqual([{ kind: "code", text: "rm -rf x" }]);
  });
});

describe("parseInline links", () => {
  const link = (text: string, href = text) => ({ kind: "link", text, href });

  it("reads a Markdown link, with or without a title", () => {
    expect(parseInline("see [the docs](https://a.dev/x) now")).toEqual([
      { kind: "text", text: "see " },
      link("the docs", "https://a.dev/x"),
      { kind: "text", text: " now" },
    ]);
    expect(parseInline('[a](https://a.dev "A title")')).toEqual([link("a", "https://a.dev")]);
  });

  it("keeps one level of parentheses in a url", () => {
    expect(parseInline("[w](https://a.dev/x_(y))")).toEqual([link("w", "https://a.dev/x_(y)")]);
  });

  it("links a bare url without the sentence around it", () => {
    expect(parseInline("Open https://a.dev/x.")).toEqual([
      { kind: "text", text: "Open " },
      link("https://a.dev/x"),
      { kind: "text", text: "." },
    ]);
    expect(parseInline("(http://localhost:5173/)")).toEqual([
      { kind: "text", text: "(" },
      link("http://localhost:5173/"),
      { kind: "text", text: ")" },
    ]);
    expect(parseInline("https://a.dev/x_(y), done")).toEqual([
      link("https://a.dev/x_(y)"),
      { kind: "text", text: ", done" },
    ]);
  });

  it("links inside bold, and keeps the bold", () => {
    expect(parseInline("**see https://a.dev**")).toEqual([
      { kind: "strong", text: "see " },
      { ...link("https://a.dev"), strong: true },
    ]);
    expect(parseInline("**[a](https://a.dev)**")).toEqual([
      { ...link("a", "https://a.dev"), strong: true },
    ]);
  });

  it("drops inline marks from a link's label", () => {
    expect(parseInline("[`a.ts`](https://a.dev)")).toEqual([link("a.ts", "https://a.dev")]);
  });

  it("never links inside code", () => {
    expect(parseInline("`https://a.dev`")).toEqual([{ kind: "code", text: "https://a.dev" }]);
    expect(parseInline("`[a](https://a.dev)`")).toEqual([
      { kind: "code", text: "[a](https://a.dev)" },
    ]);
    expect(parseMessage("```\nhttps://a.dev\n```")).toEqual([
      { kind: "code", text: "https://a.dev" },
    ]);
  });

  it("leaves anything but a web link as text", () => {
    for (const text of [
      "[x](javascript:alert(1))",
      "[x](file:///etc/passwd)",
      "[x](src/a.ts:3)",
      "[x](https://user@a.dev)",
      "https://user:secret@a.dev/",
    ]) {
      expect(parseInline(text)).toEqual([{ kind: "text", text }]);
    }
  });

  it("still reads the label of a link it refuses as Markdown", () => {
    expect(parseInline("[`a.ts`](src/a.ts)")).toEqual([
      { kind: "text", text: "[" },
      { kind: "code", text: "a.ts" },
      { kind: "text", text: "](src/a.ts)" },
    ]);
  });
});

describe("parseMessage tables", () => {
  const cell = (text: string) => [{ kind: "text", text }];

  it("reads a table with its alignment, and links and code in cells", () => {
    const text = [
      "| Name | Size | Where |",
      "|:---|--:|:-:|",
      "| `a` | 1 | [x](https://a.dev) |",
      "| b | 2 | y |",
    ].join("\n");
    expect(parseMessage(text)).toEqual([
      {
        kind: "table",
        align: ["left", "right", "center"],
        header: [cell("Name"), cell("Size"), cell("Where")],
        rows: [
          [
            [{ kind: "code", text: "a" }],
            cell("1"),
            [{ kind: "link", text: "x", href: "https://a.dev" }],
          ],
          [cell("b"), cell("2"), cell("y")],
        ],
      },
    ]);
  });

  it("accepts rows without outer pipes, and a literal pipe when escaped", () => {
    expect(parseMessage("a | b\n---|---\nx \\| y | z")).toEqual([
      {
        kind: "table",
        align: [null, null],
        header: [cell("a"), cell("b")],
        rows: [[cell("x | y"), cell("z")]],
      },
    ]);
  });

  it("fills in short rows and drops extra cells", () => {
    const [table] = parseMessage("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |");
    expect(table).toMatchObject({
      rows: [
        [cell("1"), []],
        [cell("1"), cell("2")],
      ],
    });
  });

  it("interrupts a paragraph and ends at a line without a pipe", () => {
    const blocks = parseMessage("before\n| a |\n|---|\n| 1 |\nafter");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "table", "paragraph"]);
    expect(blocks[2]).toEqual({ kind: "paragraph", inlines: cell("after") });
  });

  it("stays a paragraph without a matching delimiter row", () => {
    // How a table reads while it streams in, before the delimiter has arrived.
    expect(parseMessage("| a | b |").map((b) => b.kind)).toEqual(["paragraph"]);
    expect(parseMessage("| a | b |\n|---|").map((b) => b.kind)).toEqual(["paragraph"]);
    expect(parseMessage("| a | b |\nnot a delimiter").map((b) => b.kind)).toEqual(["paragraph"]);
  });

  it("keeps a table inside a fence as code", () => {
    expect(parseMessage("```\n| a |\n|---|\n```").map((b) => b.kind)).toEqual(["code"]);
  });
});

describe("MessageText", () => {
  function renderWithOpener(text: string, openExternal: (url: string) => Promise<void>) {
    const gateway = new FakeGateway();
    const storage = memoryStorage();
    return render(
      <AppProviders
        services={{
          store: createAppStore(gateway, { now: NOW }),
          gateway,
          navigate: () => {},
          toggleTheme: () => {},
          openExternal,
          notificationPrefs: createNotificationPrefs(() => storage),
          projectAppearance: createProjectAppearance(() => storage),
        }}
      >
        <MessageText text={text} />
      </AppProviders>,
    );
  }

  it("hands a clicked link to the browser, and the webview stays put", () => {
    const openExternal = vi.fn(async () => {});
    const { container } = renderWithOpener("[docs](https://a.dev/x)", openExternal);
    const anchor = container.querySelector("a");

    expect(anchor?.getAttribute("href")).toBe("https://a.dev/x");
    expect(anchor?.getAttribute("title")).toBe("https://a.dev/x");
    expect(anchor?.className).toContain("underline");
    // fireEvent answers false when the default action was cancelled.
    expect(fireEvent.click(anchor as HTMLAnchorElement)).toBe(false);
    expect(openExternal).toHaveBeenCalledWith("https://a.dev/x");
  });

  it("makes no anchor for a link it refuses", () => {
    const { container } = render(
      <MessageText text={"[a](javascript:alert(1)) [b](file:///etc/passwd) [c](src/a.ts)"} />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("[a](javascript:alert(1))");
  });

  it("renders a table with column headers", () => {
    const { container } = render(
      <MessageText text={"| Name | Size |\n|---|--:|\n| **a** | 1 |"} />,
    );
    const headers = container.querySelectorAll('th[scope="col"]');
    expect([...headers].map((h) => h.textContent)).toEqual(["Name", "Size"]);
    expect(headers[1]?.className).toContain("text-right");
    expect(container.querySelector("td strong")?.textContent).toBe("a");
    expect(container.querySelector("table")?.parentElement?.className).toContain("overflow-x-auto");
  });

  it("renders structure with code in DM Mono", () => {
    const { container } = render(<MessageText text={"Hi `x`\n\n- a\n- b\n\n```\ncode\n```"} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toBe("code");
    expect(container.querySelector("p code")?.className).toContain("font-mono");
  });

  it("never turns message text into HTML", () => {
    const evil = [
      "<script>window.__pwned = true</script>",
      '<img src="x" onerror="window.__pwned = true">',
      "- <b>bold?</b>",
      "`<iframe src=javascript:alert(1)>`",
      "```html\n<svg onload=alert(1)>\n```",
    ].join("\n\n");
    const { container } = render(<MessageText text={evil} />);

    for (const tag of ["script", "img", "b", "iframe", "svg"]) {
      // The copy button's own icon is the one svg allowed (decorative, aria-hidden).
      expect(container.querySelector(`${tag}:not([aria-hidden="true"])`)).toBeNull();
    }
    expect(container.textContent).toContain("<script>window.__pwned = true</script>");
    expect(container.textContent).toContain('<img src="x" onerror="window.__pwned = true">');
    expect((window as { __pwned?: boolean }).__pwned).toBeUndefined();
  });
});
