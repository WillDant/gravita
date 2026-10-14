import { describe, expect, test } from "bun:test";
import {
  type AcpProtocol,
  cursorInputPreview,
  cursorPaths,
  cursorToolCall,
  cursorToolKind,
  cursorToolName,
  cursorToolTarget,
} from "../src";

const call = (c: Omit<AcpProtocol.ToolCall, "toolCallId">): AcpProtocol.ToolCall => ({
  toolCallId: "t1",
  ...c,
});

describe("Cursor tools", () => {
  test("names: Cursor's own, an MCP tool's, else the kind", () => {
    expect(cursorToolName(call({ kind: "other", rawInput: { _toolName: "askQuestion" } }))).toBe(
      "askQuestion",
    );
    expect(cursorToolName(call({ kind: "other", title: "gravita: complete_task" }))).toBe(
      "mcp__gravita__complete_task",
    );
    expect(cursorToolName(call({ kind: "execute", title: "`ls`" }))).toBe("shell");
    expect(cursorToolName(call({ kind: "read" }))).toBe("read");
    expect(cursorToolName(call({}))).toBe("other");
    // A title with a colon on a call of a known kind is not an MCP tool.
    expect(cursorToolName(call({ kind: "read", title: "Read: notes" }))).toBe("read");
  });

  test("kinds on the line map", () => {
    expect(cursorToolKind(call({ kind: "edit" }))).toBe("edit");
    expect(cursorToolKind(call({ kind: "move" }))).toBe("edit");
    expect(cursorToolKind(call({ kind: "execute" }))).toBe("bash");
    expect(cursorToolKind(call({ kind: "fetch" }))).toBe("web");
    expect(cursorToolKind(call({ kind: "search" }))).toBe("search");
    expect(cursorToolKind(call({ kind: "other", rawInput: { _toolName: "task" } }))).toBe("agent");
    expect(cursorToolKind(call({ kind: "other", rawInput: { _toolName: "updateTodos" } }))).toBe(
      "todo",
    );
    expect(cursorToolKind(call({ kind: "other", title: "linear: list_issues" }))).toBe("mcp");
    expect(cursorToolKind(call({ kind: "other", title: "Thinking" }))).toBe("other");
  });

  test("paths from locations, input and diffs, once each", () => {
    const edit = call({
      kind: "move",
      locations: [{ path: "/w/a.ts" }],
      rawInput: { path: "/w/a.ts", destination: "/w/b.ts" },
      content: [{ type: "diff", path: "/w/c.ts", oldText: "", newText: "x" }],
    });
    expect(cursorPaths(edit)).toEqual(["/w/a.ts", "/w/b.ts", "/w/c.ts"]);
  });

  test("targets and previews", () => {
    expect(cursorToolTarget(call({ kind: "execute", title: "`pnpm test`" }))).toEqual({
      cmd: "pnpm test",
    });
    expect(
      cursorToolTarget(call({ kind: "execute", rawInput: { command: "git status" }, title: "x" })),
    ).toEqual({ cmd: "git status" });
    expect(cursorToolTarget(call({ kind: "fetch", rawInput: { url: "https://a.dev" } }))).toEqual({
      url: "https://a.dev",
    });
    expect(cursorToolTarget(call({ kind: "search", rawInput: { pattern: "TODO" } }))).toEqual({
      query: "TODO",
    });
    expect(cursorInputPreview(call({ kind: "read", locations: [{ path: "/w/a.ts" }] }))).toBe(
      "/w/a.ts",
    );
    expect(cursorInputPreview(call({ kind: "think", title: "Thinking" }))).toBe("Thinking");
  });

  test("guarded calls", () => {
    expect(
      cursorToolCall(call({ kind: "execute", rawInput: { command: "rm -rf /" } }), {
        agentId: "main",
        cwd: "/w",
      }),
    ).toEqual({
      kind: "shell",
      paths: [],
      command: "rm -rf /",
      tool: "shell",
      agentId: "main",
      cwd: "/w",
    });
    expect(cursorToolCall(call({ kind: "edit", locations: [{ path: "/w/a.ts" }] }))).toEqual({
      kind: "edit",
      paths: ["/w/a.ts"],
      tool: "edit",
    });
    expect(cursorToolCall(call({ kind: "fetch", rawInput: { url: "https://a.dev" } })).kind).toBe(
      "web",
    );
    expect(cursorToolCall(call({ kind: "other", title: "gravita: complete_task" })).kind).toBe(
      "gravita",
    );
    expect(cursorToolCall(call({ kind: "other", title: "linear: list_issues" })).kind).toBe(
      "other",
    );
    expect(
      cursorToolCall(call({ kind: "other", rawInput: { _toolName: "askQuestion" } })).kind,
    ).toBe("ask");
  });
});
