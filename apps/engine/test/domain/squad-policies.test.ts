import { describe, expect, test } from "bun:test";
import { claudeToolCall } from "@gravita/adapter-claude";
import type { SquadAutonomy } from "@gravita/protocol";
import {
  isNetworkCommand,
  rolePermission,
  rolePermissionMode,
} from "../../src/domain/autonomy-policy";
import { guardToolCall, type OwnershipScope } from "../../src/domain/ownership-guard";
import { simpleCommands } from "../../src/domain/shell-command";
import { plannerBudget, squadModels, taskBudget } from "../../src/domain/squad-policy";
import { plannerPermission } from "../../src/infrastructure/claude/sdk/claude-access";
import { squadEnv } from "../../src/infrastructure/claude/sdk/claude-subagent-env";
import { testPlan } from "../git-helpers";

const WT = "/data/worktrees/p1/q1/frontend";
const scope: OwnershipScope = {
  plan: testPlan(),
  roleId: "frontend",
  roots: [WT, `/private${WT}`],
};
// Claude Code's tool calls, through the Claude adapter to the provider-neutral guard.
const guard = (toolName: string, input: Record<string, unknown>, more = {}) =>
  guardToolCall(scope, claudeToolCall(toolName, input, more));

describe("shell parsing", () => {
  test.each([
    [
      "git status && git commit -m x",
      [
        ["git", "status"],
        ["git", "commit", "-m", "x"],
      ],
    ],
    ["FOO=1 sudo -u me git push", [["git", "push"]]],
    [
      'echo "a; b" | tee out',
      [
        ["echo", "a; b"],
        ["tee", "out"],
      ],
    ],
    [
      "echo $(git reset --hard)",
      [
        ["echo", "$(…)"],
        ["git", "reset", "--hard"],
      ],
    ],
    [
      "echo `git stash`",
      [
        ["echo", "$(…)"],
        ["git", "stash"],
      ],
    ],
    [
      "bash -c 'cd / && rm -rf x'",
      [
        ["bash", "-c", "cd / && rm -rf x"],
        ["cd", "/"],
        ["rm", "-rf", "x"],
      ],
    ],
    [
      "eval git tag v1",
      [
        ["eval", "git", "tag", "v1"],
        ["git", "tag", "v1"],
      ],
    ],
    ["timeout 10 env -i X=1 git branch -D main", [["git", "branch", "-D", "main"]]],
    ["(cd sub; ls)", [["cd", "sub"], ["ls"]]],
    ["npm test 2>&1 > /tmp/log", [["npm", "test"]]],
  ])("%s", (line, argvs) => {
    expect(simpleCommands(line).map((c) => c.argv)).toEqual(argvs);
  });

  test("output redirections are collected; input and fd duplications aren't", () => {
    const [c] = simpleCommands("cat < in.txt > out.txt 2>&1 >> log.txt");
    expect(c).toEqual({ argv: ["cat"], writes: ["out.txt", "log.txt"] });
  });
});

describe("ownership guard: file tools", () => {
  test.each([
    ["Write", { file_path: `${WT}/apps/web/App.tsx` }, undefined],
    ["Edit", { file_path: "apps/web/src/x.ts" }, undefined],
    ["MultiEdit", { file_path: `/private${WT}/apps/web/a.ts` }, undefined],
    ["NotebookEdit", { notebook_path: `${WT}/apps/web/n.ipynb` }, undefined],
    [
      "Write",
      { file_path: `${WT}/apps/api/index.ts` },
      "backend owns apps/api/ — ask backend with request_change (you own apps/web/).",
    ],
    ["Edit", { file_path: "apps/web/../api/index.ts" }, "backend owns apps/api/"],
    ["Write", { file_path: `${WT}/pnpm-lock.yaml` }, "pnpm-lock.yaml is shared"],
    ["Edit", { file_path: "package.json" }, "package.json is shared"],
    ["Write", { file_path: `${WT}/docs/notes.md` }, "docs/notes.md isn't in what you own"],
    ["Write", { file_path: "/etc/hosts" }, "/etc/hosts is outside your worktree"],
    ["Write", { file_path: "../backend/apps/api/x.ts" }, "is outside your worktree"],
    ["NotebookEdit", { notebook_path: "/tmp/n.ipynb" }, "outside your worktree"],
    ["Write", { file_path: `${WT}/.git` }, "Gravita's (git metadata)"],
    ["Edit", { file_path: "apps/webapp/x.ts" }, "isn't in what you own"],
    ["Read", { file_path: "/etc/hosts" }, undefined],
  ])("%s %j", (tool, input, want) => {
    const got = guard(tool, input);
    if (want === undefined) expect(got).toBeUndefined();
    else expect(got).toContain(want);
  });

  test("relative paths resolve from the agent's cwd", () => {
    expect(guard("Write", { file_path: "App.tsx" }, { cwd: `${WT}/apps/web` })).toBeUndefined();
    expect(guard("Write", { file_path: "../api/x.ts" }, { cwd: `${WT}/apps/web` })).toContain(
      "backend owns",
    );
  });

  test("a subagent's call is judged the same, and the reason names it", () => {
    const got = guard("Write", { file_path: "apps/api/x.ts" }, { agentId: "a7f" });
    expect(got).toEndWith("(asked by subagent a7f)");
    expect(got).toContain("backend owns apps/api/");
  });
});

describe("ownership guard: Bash", () => {
  test.each([
    ["git status", undefined],
    ["git diff --stat HEAD~1", undefined],
    ["git log --oneline -5 && git show HEAD", undefined],
    ["git -C apps/web status", undefined],
    ["git branch", undefined],
    ["git branch -a --contains abc123", undefined],
    ["git branch --list 'feat*'", undefined],
    ["git stash list", undefined],
    ["git config --get user.name", undefined],
    ["git --version", undefined],
    ["git commit -m 'done'", "git commit changes the repository"],
    ["git push origin HEAD", "git push"],
    ["git merge main", "git merge"],
    ["git rebase -i main", "git rebase"],
    ["git reset --hard HEAD~1", "git reset"],
    ["git checkout main", "git checkout"],
    ["git switch -c x", "git switch"],
    ["git branch -D main", "git branch"],
    ["git branch newbranch", "git branch"],
    ["git tag v1", "git tag"],
    ["git stash", "git stash"],
    ["git worktree add ../x", "git worktree"],
    ["git clean -fdx", "git clean"],
    ["git add -A", "git add"],
    ["git restore apps/api/index.ts", undefined],
    ["git checkout -- apps/api/index.ts", undefined],
    ["git restore --source=main x", "git restore"],
    ["git config user.name x", "git config"],
    ["pnpm test; git commit -am wip", "git commit"],
    ["echo $(git commit -am x)", "git commit"],
    ['sh -c "git push"', "git push"],
    ["git -C /other/repo status", "points outside your worktree"],
    ["cd apps/web && pnpm test", undefined],
    ["cd /tmp", "cd /tmp leaves your worktree"],
    ["cd ..", "cd .. leaves your worktree"],
    ["cd", "would leave your worktree"],
    ["cd ~/code", "would leave your worktree"],
    [`cd ${WT}/apps`, undefined],
    ["rm -rf apps/web/dist", undefined],
    ["rm -rf /", "reaches outside your worktree"],
    ["rm -rf ../integration", "reaches outside your worktree"],
    ["cd apps && rm -rf ../../backend", "reaches outside your worktree"],
    ["rm -r -f $HOME/x", "use a plain path"],
    ["rm -rf .", "would delete your worktree"],
    ["rm -rf .git", "would delete your worktree"],
    ["rm /tmp/x", undefined],
    ["pnpm build > dist/log.txt", undefined],
    ["pnpm build > /tmp/log.txt", "would leave your worktree"],
    ["pnpm build > /dev/null 2>&1", undefined],
  ])("%s", (command, want) => {
    const got = guard("Bash", { command });
    if (want === undefined) expect(got).toBeUndefined();
    else expect(got).toContain(want);
  });

  test("git's refusal says what to do instead", () => {
    expect(guard("Bash", { command: "git commit -m x" })).toContain(
      "it commits your work when you call complete_task",
    );
  });
});

describe("autonomy policy", () => {
  const cases: [string, Record<string, unknown>, Record<SquadAutonomy, string>][] = [
    ["mcp__gravita__complete_task", {}, { auto: "allow", guarded: "allow", ask: "allow" }],
    ["AskUserQuestion", {}, { auto: "ask", guarded: "ask", ask: "ask" }],
    ["Read", { file_path: "x" }, { auto: "allow", guarded: "allow", ask: "allow" }],
    ["Grep", {}, { auto: "allow", guarded: "allow", ask: "allow" }],
    ["Agent", {}, { auto: "allow", guarded: "allow", ask: "allow" }],
    ["Edit", {}, { auto: "allow", guarded: "allow", ask: "ask" }],
    ["Write", {}, { auto: "allow", guarded: "allow", ask: "ask" }],
    ["Bash", { command: "pnpm test" }, { auto: "allow", guarded: "allow", ask: "ask" }],
    ["Bash", { command: "pnpm add zod" }, { auto: "allow", guarded: "ask", ask: "ask" }],
    ["Bash", { command: "npm install" }, { auto: "allow", guarded: "ask", ask: "ask" }],
    ["Bash", { command: "yarn" }, { auto: "allow", guarded: "ask", ask: "ask" }],
    ["Bash", { command: "curl https://x.dev" }, { auto: "allow", guarded: "ask", ask: "ask" }],
    ["Bash", { command: "cd a && npx vite" }, { auto: "allow", guarded: "ask", ask: "ask" }],
    ["WebFetch", { url: "https://x" }, { auto: "allow", guarded: "ask", ask: "ask" }],
    ["WebSearch", {}, { auto: "allow", guarded: "ask", ask: "ask" }],
    ["mcp__other__tool", {}, { auto: "allow", guarded: "ask", ask: "ask" }],
  ];
  for (const [tool, input, want] of cases)
    for (const autonomy of ["auto", "guarded", "ask"] as const)
      test(`${autonomy}: ${tool} ${JSON.stringify(input)} → ${want[autonomy]}`, () => {
        expect(rolePermission(autonomy, claudeToolCall(tool, input))).toBe(want[autonomy] as never);
      });

  test.each([
    ["python3 -m pip install requests", true],
    ["pip install -r requirements.txt", true],
    ["go get example.com/x", true],
    ["git fetch origin", true],
    ["pnpm -r test", false],
    ["node -e 'console.log(1)'", false],
    ["cargo build", false],
  ])("network: %s → %p", (cmd, want) => {
    expect(isNetworkCommand(cmd)).toBe(want);
  });

  test("the planner reads and nothing else; modes follow the autonomy", () => {
    expect(["Read", "Grep", "Glob", "Bash", "Write"].map(plannerPermission)).toEqual([
      "allow",
      "allow",
      "allow",
      "deny",
      "deny",
    ]);
    expect([
      rolePermissionMode("auto"),
      rolePermissionMode("guarded"),
      rolePermissionMode("ask"),
    ]).toEqual(["acceptEdits", "acceptEdits", "default"]);
  });
});

describe("budget slices", () => {
  test("the planner gets a tenth, at least $1, never more than the budget", () => {
    expect([plannerBudget(50), plannerBudget(5), plannerBudget(0.5)]).toEqual([5, 1, 0.5]);
  });

  test("a task gets its role's budget, else its share of the estimate with headroom", () => {
    const plan = testPlan();
    const models = { planner: "opus", roles: "opus" };
    // Two tasks of the same size: half each, times 1.5.
    expect(taskBudget(plan, models, 20, "api-1")).toBeCloseTo(15);
    const withRole = {
      ...plan,
      roles: plan.roles.map((r) => (r.id === "backend" ? { ...r, budgetUsd: 4 } : r)),
    };
    expect(taskBudget(withRole, models, 20, "api-1")).toBe(4);
  });

  test("a task's share prices it at the model its run uses", () => {
    const plan = testPlan();
    const auto = squadModels();
    // Both small tasks on Sonnet under Automatic: half each, times 1.5.
    expect(taskBudget(plan, auto, 20, "api-1")).toBeCloseTo(15);
    // An escalated run on Opus is the bigger share of the same squad budget.
    const escalated = taskBudget(plan, auto, 20, "api-1", "opus");
    expect(escalated).toBeGreaterThan(15);
    expect(escalated).toBeLessThanOrEqual(20);
  });
});

describe("model policy", () => {
  test("new squads run Automatic; a client's planner and roles alone mean fixed models", () => {
    expect(squadModels()).toEqual({
      mode: "auto",
      briefing: "sonnet",
      planner: "opus",
      roles: "sonnet",
    });
    expect(squadModels({ planner: "opus", roles: "opus" })).toEqual({
      mode: "fixed",
      planner: "opus",
      roles: "opus",
    });
    expect(squadModels({ mode: "auto", planner: "opus", roles: "haiku" })).toEqual({
      mode: "auto",
      briefing: "sonnet",
      planner: "opus",
      roles: "haiku",
    });
  });

  test("subagents run on Haiku under Automatic only", () => {
    expect(squadEnv(squadModels())).toEqual({ CLAUDE_CODE_SUBAGENT_MODEL: "haiku" });
    expect(squadEnv({ mode: "fixed", planner: "opus", roles: "opus" })).toEqual({});
    expect(squadEnv({ planner: "opus", roles: "opus" })).toEqual({});
  });
});
