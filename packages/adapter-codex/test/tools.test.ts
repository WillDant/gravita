import { describe, expect, test } from "bun:test";
import {
  codeModeCommands,
  codexConversationOf,
  codexInputPreview,
  codexToolCall,
  codexToolKind,
  codexToolName,
  codexToolTarget,
  groupThreads,
  parsePatch,
  parseRolloutLines,
  patchPaths,
  typedText,
} from "../src";
import { scenarioFiles, scenarioSession } from "./helpers";

const PATCH = [
  "*** Begin Patch",
  "*** Add File: docs/new.md",
  "+# New",
  "+",
  "+text",
  "*** Update File: src/a.ts",
  "*** Move to: src/b.ts",
  "@@ function a()",
  " context",
  "-old",
  "+new",
  "*** End of File",
  "*** Delete File: src/gone.ts",
  "*** End Patch",
].join("\n");

describe("apply_patch", () => {
  test("headers and line counts", () => {
    expect(parsePatch(PATCH)).toEqual([
      { path: "docs/new.md", op: "add", added: 3, removed: 0 },
      { path: "src/a.ts", op: "update", movedTo: "src/b.ts", added: 1, removed: 1 },
      { path: "src/gone.ts", op: "delete", added: 0, removed: 0 },
    ]);
    expect(patchPaths(parsePatch(PATCH))).toEqual([
      "docs/new.md",
      "src/a.ts",
      "src/b.ts",
      "src/gone.ts",
    ]);
    expect(parsePatch("no patch here")).toEqual([]);
  });

  test("target and preview name the files", () => {
    expect(codexToolTarget("apply_patch", PATCH)).toEqual({ path: "docs/new.md" });
    expect(codexToolTarget("apply_patch", { input: PATCH })).toEqual({ path: "docs/new.md" });
    expect(codexInputPreview("apply_patch", PATCH)).toBe("docs/new.md, src/b.ts, src/gone.ts");
  });
});

describe("Codex tool table", () => {
  test.each([
    ["exec_command", "bash"],
    ["write_stdin", "bash"],
    ["exec", "bash"],
    ["shell", "bash"],
    ["apply_patch", "edit"],
    ["read_file", "read"],
    ["grep_files", "search"],
    ["web_search_call", "web"],
    ["mcp__linear__get_issue", "mcp"],
    ["spawn_agent", "agent"],
    ["wait_agent", "other"],
    ["update_plan", "todo"],
    ["request_user_input", "ask"],
    ["something_new", "other"],
  ] as const)("%s is %s", (name, kind) => {
    expect(codexToolKind(name)).toBe(kind);
  });

  test("MCP calls recorded with a namespace get their full name", () => {
    expect(codexToolName("js", "mcp__repl")).toBe("mcp__repl__js");
    expect(codexToolName("mcp__a__b", "mcp__a")).toBe("mcp__a__b");
    expect(codexToolName("exec_command")).toBe("exec_command");
  });

  test("commands as strings, argv and the older bash -lc wrapper", () => {
    expect(codexToolTarget("exec_command", { cmd: "pnpm test" })).toEqual({ cmd: "pnpm test" });
    expect(codexToolTarget("shell", { command: ["bash", "-lc", "ls -la"] })).toEqual({
      cmd: "ls -la",
    });
    expect(codexToolTarget("shell", { command: ["git", "status"] })).toEqual({
      cmd: "git status",
    });
    expect(codexToolTarget("spawn_agent", { agent_type: "explorer" })).toEqual({
      agentType: "explorer",
    });
  });

  test("code-mode scripts show the commands they run", () => {
    expect(
      codeModeCommands(`const r = await tools.exec_command({cmd:"echo \\"hi\\" > a.txt"});`),
    ).toEqual(['echo "hi" > a.txt']);
    expect(codeModeCommands("await tools.exec_command({ cmd: 'it\\'s \"ok\"' });")).toEqual([
      `it's "ok"`,
    ]);
    const two =
      'await tools.exec_command({cmd:"pnpm build"});\nawait tools.exec_command({cmd:"pnpm test"});';
    expect(codexToolTarget("exec", two)).toEqual({ cmd: "pnpm build (+1)" });
    expect(codexInputPreview("exec", two)).toBe("pnpm build (+1)");
    // A command built at run time isn't guessed: the first line stands for the script.
    expect(
      codexToolTarget("exec", "const c = pick();\nawait tools.exec_command({cmd: c});"),
    ).toEqual({
      cmd: "const c = pick();",
    });
  });

  test("guarded calls: patches name every file, scripts can't be judged", () => {
    expect(codexToolCall("apply_patch", PATCH)).toEqual({
      kind: "edit",
      paths: ["docs/new.md", "src/a.ts", "src/b.ts", "src/gone.ts"],
      tool: "apply_patch",
    });
    expect(codexToolCall("exec_command", { cmd: "ls" }, { agentId: "codex:x", cwd: "/w" })).toEqual(
      {
        kind: "shell",
        paths: [],
        command: "ls",
        tool: "exec_command",
        agentId: "codex:x",
        cwd: "/w",
      },
    );
    expect(codexToolCall("exec", "await tools.exec_command({cmd:'rm -rf /'})").kind).toBe("other");
    expect(codexToolCall("write_stdin", { chars: "y" }).kind).toBe("other");
    expect(codexToolCall("spawn_agent", { message: "x" }).kind).toBe("read");
    expect(codexToolCall("list_dir", { dir_path: "src" })).toMatchObject({
      kind: "read",
      paths: ["src"],
    });
  });
});

describe("user turns", () => {
  test("injected context is not what the person typed", () => {
    const content = [
      {
        type: "input_text",
        text: "# AGENTS.md instructions for /w\n\n<INSTRUCTIONS>x</INSTRUCTIONS>",
      },
      { type: "input_text", text: "<environment_context>\n<cwd>/w</cwd>\n</environment_context>" },
      { type: "input_text", text: "Fix the bug" },
      { type: "input_image", image_url: "data:..." },
    ];
    expect(typedText(content)).toBe("Fix the bug");
    expect(typedText([content[1]])).toBe("");
    // A prompt that merely starts with a tag is still the person's.
    expect(typedText([{ type: "input_text", text: "<div> is wrong here" }])).toBe(
      "<div> is wrong here",
    );
  });
});

describe("codexConversationOf", () => {
  test("prompts and replies with full text, spawns as chips", async () => {
    const session = await scenarioSession("nested-background");
    const lines = parseRolloutLines(await Bun.file(session.root.path).text());
    const conv = codexConversationOf(lines, session.root.meta.threadId);
    expect(conv.map((m) => [m.role, m.text, m.spawned?.map((s) => s.agentType)])).toEqual([
      ["user", "Map the auth flow and plan the migration", undefined],
      ["assistant", "", ["explorer", "worker"]],
      ["assistant", "While that runs, I'll read the config.\n\nHere is the plan.", undefined],
    ]);
    expect(conv[1]?.spawned?.map((s) => s.toolUseId)).toEqual(["codex:call_A1", "codex:call_A2"]);
    for (const m of conv) expect(m.uuid).toStartWith(`codex:${session.root.meta.threadId}:`);
  });

  test("grouping leaves internal threads and orphans out", async () => {
    const files = await scenarioFiles("subagents");
    const [root, e1, e2] = files;
    expect(groupThreads(files)).toHaveLength(1);
    // Without the root rollout, its subagents have nowhere to go.
    expect(groupThreads([e1!, e2!])).toEqual([]);
    expect(groupThreads([root!])[0]?.subagents).toEqual([]);
  });
});
