import { describe, expect, test } from "bun:test";
import { claudeToolCall } from "@gravita/adapter-claude";
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
