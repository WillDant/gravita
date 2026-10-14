import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MessageText } from "./MessageText";
import { parseMessage } from "./parseMessage";

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

describe("MessageText", () => {
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
