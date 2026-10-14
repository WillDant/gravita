import { describe, expect, test } from "bun:test";
import { acpSessionIdOf, cursorCallId, cursorMessageId, cursorSessionId } from "../src";

describe("Cursor ids", () => {
  test("every id carries the cursor: prefix once", () => {
    expect(cursorSessionId("abc")).toBe("cursor:abc");
    expect(cursorSessionId("cursor:abc")).toBe("cursor:abc");
    expect(cursorCallId("abc", "tool_1")).toBe("cursor:abc:tool_1");
    expect(cursorMessageId("abc", "u1", 2)).toBe("cursor:abc:u1:2");
  });

  test("a tool call id is unique across sessions", () => {
    expect(cursorCallId("s1", "tool_1")).not.toBe(cursorCallId("s2", "tool_1"));
  });

  test("the ACP session id comes back only from a Cursor id", () => {
    expect(acpSessionIdOf("cursor:abc")).toBe("abc");
    expect(acpSessionIdOf("codex:abc")).toBeUndefined();
    expect(acpSessionIdOf("abc")).toBeUndefined();
  });
});
