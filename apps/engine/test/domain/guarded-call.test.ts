import { describe, expect, test } from "bun:test";
import { claudeToolCall } from "@gravita/adapter-claude";
import { codexToolCall } from "@gravita/adapter-codex";
import { type AcpProtocol, cursorToolCall, cursorToolName } from "@gravita/adapter-cursor";
import type { GuardedCall } from "@gravita/protocol/tools";
import { rolePermission } from "../../src/domain/autonomy-policy";
import { guardToolCall } from "../../src/domain/ownership-guard";
import { GUARD_TABLE, type GuardCase, SCOPE, WT } from "../contracts/guarded-call-table";

/** Judges one call the way a role session's guard and policy do. */
function judge(call: GuardedCall) {
  return {
    denied: guardToolCall(SCOPE, call),
    permission: {
      auto: rolePermission("auto", call),
      guarded: rolePermission("guarded", call),
      ask: rolePermission("ask", call),
    },
  };
}

function expectCase(c: GuardCase, call: GuardedCall) {
  const got = judge(call);
  if (c.denied === undefined) expect(got.denied).toBeUndefined();
  else expect(got.denied).toContain(c.denied);
  expect(got.permission).toEqual({ ...c.permission });
}

describe("guarded calls: the provider-neutral table", () => {
  for (const c of GUARD_TABLE) test(c.intent, () => expectCase(c, { ...c.call, tool: "neutral" }));

  test("an edit is judged path by path; the first refusal wins", () => {
    const call: GuardedCall = {
      kind: "edit",
      paths: [`${WT}/apps/web/a.ts`, `${WT}/apps/api/b.ts`],
      tool: "patch",
    };
    expect(guardToolCall(SCOPE, call)).toContain("backend owns apps/api/");
  });

  test("a subagent's call names it in the refusal", () => {
    const call: GuardedCall = { kind: "edit", paths: ["/etc/x"], tool: "t", agentId: "a7" };
    expect(guardToolCall(SCOPE, call)).toEndWith("(asked by subagent a7)");
  });
});

/** Claude Code's call for each intent of the table. */
const CLAUDE_CALLS: Record<string, [string, Record<string, unknown>]> = {
  "write a file it owns": ["Write", { file_path: `${WT}/apps/web/App.tsx`, content: "x" }],
  "edit a file another role owns": ["Edit", { file_path: `${WT}/apps/api/index.ts` }],
  "edit a shared file": ["Edit", { file_path: "package.json" }],
  "edit a file outside the worktree": ["MultiEdit", { file_path: "/etc/hosts", edits: [] }],
  "read a file anywhere": ["Read", { file_path: "/etc/hosts" }],
  "run a local command": ["Bash", { command: "pnpm test", description: "Run the tests" }],
  "install a package": ["Bash", { command: "pnpm add zod" }],
  "commit with git": ["Bash", { command: "git commit -m x" }],
  "leave the worktree": ["Bash", { command: "cd /tmp" }],
  "fetch a web page": ["WebFetch", { url: "https://x.dev", prompt: "read" }],
  "ask the user a question": ["AskUserQuestion", { questions: [] }],
  "call one of Gravita's role tools": ["mcp__gravita__complete_task", { summary: "done" }],
  "call another server's tool": ["mcp__other__tool", {}],
};

describe("guarded calls: Claude Code's adapter satisfies the table", () => {
  test("every intent has a Claude Code call", () => {
    expect(Object.keys(CLAUDE_CALLS).sort()).toEqual(GUARD_TABLE.map((c) => c.intent).sort());
  });

  for (const c of GUARD_TABLE)
    test(c.intent, () => {
      const [tool, input] = CLAUDE_CALLS[c.intent] ?? ["", {}];
      const call = claudeToolCall(tool, input);
      expect(call).toEqual({ ...c.call, tool });
      expectCase(c, call);
    });

  test.each([
    ["NotebookEdit", { notebook_path: "n.ipynb" }, "edit", ["n.ipynb"]],
    ["Grep", { pattern: "x", path: "src" }, "read", ["src"]],
    ["Agent", { prompt: "look" }, "read", []],
    ["TodoWrite", { todos: [] }, "read", []],
    ["WebSearch", { query: "x" }, "web", []],
    ["Bash", { command: 42 }, "shell", []],
  ] as const)("%s is a %s call", (tool, input, kind, paths) => {
    expect(claudeToolCall(tool, input)).toMatchObject({ kind, paths: [...paths], tool });
  });

  test("the agent and its working directory travel with the call", () => {
    expect(claudeToolCall("Bash", { command: "ls" }, { agentId: "a1", cwd: WT })).toEqual({
      kind: "shell",
      paths: [],
      command: "ls",
      tool: "Bash",
      agentId: "a1",
      cwd: WT,
    });
  });
});

const patch = (op: "Add" | "Update", path: string) =>
  `*** Begin Patch\n*** ${op} File: ${path}\n+x\n*** End Patch\n`;

/** Codex's call for each intent of the table: arguments, or a custom tool's raw input. */
const CODEX_CALLS: Record<string, [string, Record<string, unknown> | string]> = {
  "write a file it owns": ["apply_patch", patch("Add", `${WT}/apps/web/App.tsx`)],
  "edit a file another role owns": ["apply_patch", patch("Update", `${WT}/apps/api/index.ts`)],
  "edit a shared file": ["apply_patch", { input: patch("Update", "package.json") }],
  "edit a file outside the worktree": ["apply_patch", patch("Update", "/etc/hosts")],
  "read a file anywhere": ["read_file", { file_path: "/etc/hosts" }],
  "run a local command": ["exec_command", { cmd: "pnpm test", workdir: WT }],
  "install a package": ["exec_command", { cmd: "pnpm add zod" }],
  "commit with git": ["exec_command", { cmd: "git commit -m x" }],
  "leave the worktree": ["shell", { command: ["bash", "-lc", "cd /tmp"] }],
  "fetch a web page": ["web_search", { query: "x" }],
  "ask the user a question": ["request_user_input", { questions: [] }],
  "call one of Gravita's role tools": ["mcp__gravita__complete_task", { summary: "done" }],
  "call another server's tool": ["mcp__other__tool", {}],
};

describe("guarded calls: Codex's adapter satisfies the table", () => {
  test("every intent has a Codex call", () => {
    expect(Object.keys(CODEX_CALLS).sort()).toEqual(GUARD_TABLE.map((c) => c.intent).sort());
  });

  for (const c of GUARD_TABLE)
    test(c.intent, () => {
      const [tool, input] = CODEX_CALLS[c.intent] ?? ["", {}];
      const call = codexToolCall(tool, input);
      expect(call).toEqual({ ...c.call, tool });
      expectCase(c, call);
    });

  test("a patch is judged file by file; a script that can't be read is asked about", () => {
    const both = `*** Begin Patch\n*** Update File: ${WT}/apps/web/a.ts\n*** Add File: ${WT}/apps/api/b.ts\n*** End Patch`;
    expect(guardToolCall(SCOPE, codexToolCall("apply_patch", both))).toContain(
      "backend owns apps/api/",
    );
    const script = codexToolCall("exec", "await tools.exec_command({ cmd: 'git push' })");
    expect(judge(script).permission).toEqual({ auto: "allow", guarded: "ask", ask: "ask" });
  });
});

const at = (path: string) => ({ locations: [{ path }] });

/** Cursor's ACP tool call for each intent of the table. */
const CURSOR_CALLS: Record<string, Omit<AcpProtocol.ToolCall, "toolCallId">> = {
  "write a file it owns": { kind: "edit", ...at(`${WT}/apps/web/App.tsx`) },
  "edit a file another role owns": { kind: "edit", ...at(`${WT}/apps/api/index.ts`) },
  "edit a shared file": { kind: "edit", rawInput: { path: "package.json" } },
  "edit a file outside the worktree": { kind: "delete", ...at("/etc/hosts") },
  "read a file anywhere": { kind: "read", ...at("/etc/hosts") },
  "run a local command": { kind: "execute", rawInput: { command: "pnpm test" } },
  "install a package": { kind: "execute", title: "`pnpm add zod`" },
  "commit with git": { kind: "execute", rawInput: { command: "git commit -m x" } },
  "leave the worktree": { kind: "execute", rawInput: { command: "cd /tmp" } },
  "fetch a web page": { kind: "fetch", rawInput: { url: "https://x.dev" } },
  "ask the user a question": { kind: "other", rawInput: { _toolName: "askQuestion" } },
  "call one of Gravita's role tools": { kind: "other", title: "gravita: complete_task" },
  "call another server's tool": { kind: "other", title: "other: tool" },
};

describe("guarded calls: Cursor's adapter satisfies the table", () => {
  test("every intent has a Cursor call", () => {
    expect(Object.keys(CURSOR_CALLS).sort()).toEqual(GUARD_TABLE.map((c) => c.intent).sort());
  });

  for (const c of GUARD_TABLE)
    test(c.intent, () => {
      const acp = { toolCallId: "t1", ...CURSOR_CALLS[c.intent] };
      const call = cursorToolCall(acp);
      expect(call).toEqual({ ...c.call, tool: cursorToolName(acp) });
      expectCase(c, call);
    });
});
