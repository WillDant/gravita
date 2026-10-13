import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { SAMPLE_SQUAD_PLAN } from "@gravita/adapter-fake";
import { outsideOwnership, squadPlan } from "@gravita/core";
import type { GravitaEvent, SquadPlan } from "@gravita/protocol";
import { BASE_FILES, sh, testPlan, userRepo } from "../git-helpers";
import { withTempDir } from "../helpers";
import { createAndPlan, type ScriptedAgent, squadCore } from "../squad-fakes";

// A whole squad, end to end, at no cost: the planner and every role are scripted sessions
// (the real ClaudeSdkRuntime around a fake query), everything else is real — the
// orchestrator, git worktrees and branches, the commit gate, the merge queue and the checks.

const OK = ["node", "-e", "process.exit(0)"];

/** The demo's todo-app plan, with checks that run anywhere (node, no pnpm). */
function todoPlan(): SquadPlan {
  return {
    ...SAMPLE_SQUAD_PLAN,
    checks: [
      { id: "task-ok", argv: OK, cwd: ".", when: "task" },
      { id: "integration-ok", argv: OK, cwd: ".", when: "integration" },
      {
        id: "files",
        argv: [
          "node",
          "-e",
          "require('fs').accessSync('apps/api/src/index.ts'),require('fs').accessSync('apps/web/src/App.tsx')",
        ],
        cwd: ".",
        when: "final",
      },
    ],
  };
}

/** The "Paths it changes" of a task, from its first message. */
function writesOf(prompt: string): string[] {
  const block = /Paths it changes:\n((?:- .*\n?)+)/.exec(prompt)?.[1] ?? "";
  return block
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));
}

/** Writes a file for each path the task changes (a folder gets a file named after the task). */
async function doTheWork(a: ScriptedAgent, taskId: string, prompt: string) {
  const files: Record<string, string> = {};
  for (const w of writesOf(prompt)) {
    const file = w.endsWith("/")
      ? `${w}${taskId === "contracts" ? "openapi.yaml" : `${taskId}.ts`}`
      : w;
    files[file] = `// ${taskId}\n`;
  }
  await a.write(files);
}

async function finish(a: ScriptedAgent, cost: number) {
  const done = await a.tool("complete_task", { summary: "Done." });
  if (done.isError) throw new Error(`complete_task failed: ${done.text}`);
  a.result({ cost });
}

describe("a squad end to end (scripted sessions, real git)", () => {
  test("an empty folder → plan → foundation → build → verify → deliver (merge)", async () => {
    await withTempDir(async (tmp) => {
      const cwd = join(tmp, "todo");
      await mkdir(cwd);
      let running = 0;
      let maxRunning = 0;
      const hookAnswers: (string | undefined)[] = [];
      const toolTexts: Record<string, string> = {};

      const h = squadCore(tmp, async (a) => {
        // The briefing says nothing: the test asks for the plan at once.
        if (a.isBriefing) return;
        if (a.isPlanner) {
          await a.prompt(1);
          return a.result({ structured: todoPlan(), cost: 0.4 });
        }
        running++;
        maxRunning = Math.max(maxRunning, running);
        try {
          const prompt = await a.prompt(1);
          const taskId = await a.taskId();
          await a.tool("report_progress", { text: `Working on ${taskId}` });
          if (taskId === "web-shell") {
            // The first ownership layer: the hook refuses, also inside a subagent.
            hookAnswers.push(
              await a.preToolUse("Write", { file_path: join(a.cwd, "apps/api/src/x.ts") }),
              await a.preToolUse("Bash", { command: "git commit -am wip" }, "agent-sub1"),
              await a.preToolUse("Write", { file_path: "apps/web/src/main.tsx" }),
            );
            // The layer that counts: a write the hook didn't see (a script) is caught at commit.
            await a.write({ "apps/api/src/hack.ts": "// not mine\n" });
            await doTheWork(a, taskId, prompt);
            const bounced = await a.tool("complete_task", { summary: "Shell." });
            toolTexts.bounced = bounced.text;
            if (!bounced.isError) throw new Error("the violation was committed");
            await rm(join(a.cwd, "apps/api/src/hack.ts"));
            return await finish(a, 0.1);
          }
          if (taskId === "api-store") {
            await doTheWork(a, taskId, prompt);
            // Ends the turn without complete_task: Gravita nudges once.
            a.result({ cost: 0.05 });
            toolTexts.nudge = await a.prompt(2);
            return await finish(a, 0.1);
          }
          if (taskId === "tests-api") {
            toolTexts.contract = (
              await a.tool("read_contract", { path: "packages/contracts/openapi.yaml" })
            ).text;
            toolTexts.cr = (
              await a.tool("request_change", {
                toRole: "backend",
                text: "Add GET /health to the contract",
              })
            ).text;
            toolTexts.bug = (
              await a.tool("report_bug", {
                paths: ["apps/web/src/App.tsx"],
                text: "The title is missing",
              })
            ).text;
            toolTexts.notes = (await a.tool("read_notes")).text;
          }
          await doTheWork(a, taskId, prompt);
          await finish(a, 0.1);
        } finally {
          running--;
        }
      });

      const { squadId, projectId } = await createAndPlan(h, {
        cwd,
        brief: "A todo app",
        budgetUsd: 50,
        autonomy: "guarded",
      });
      await h.squads.idle(squadId);
      expect(h.squad(squadId).phase).toBe("review");

      const question = todoPlan().questions[0] as string;
      await h.squads.approvePlan({
        squadId,
        plan: h.squad(squadId).plan as SquadPlan,
        answers: { [question]: "Keep them visible" },
      });
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);

      const q = h.squad(squadId);
      const plan = squadPlan(q) as SquadPlan;
      expect(q.phase).toBe("deliver");
      // Every task, the two that roles added on the way included, is done.
      expect(plan.tasks.map((t) => t.id)).toEqual([
        ...SAMPLE_SQUAD_PLAN.tasks.map((t) => t.id),
        "cr-1",
        "bug-1",
      ]);
      for (const t of plan.tasks)
        expect({ t: t.id, s: q.tasks[t.id]?.status }).toEqual({ t: t.id, s: "done" });
      expect(q.tasks["cr-1"]?.role).toBe("backend");
      expect(q.tasks["bug-1"]?.role).toBe("frontend");
      expect(q.changeRequests["cr-1"]?.state).toBe("done");
      expect(q.answers).toEqual({ [question]: "Keep them visible" });

      // The ownership layers.
      expect(hookAnswers[0]).toContain("backend owns apps/api/, packages/contracts/");
      expect(hookAnswers[1]).toContain("git commit changes the repository");
      expect(hookAnswers[1]).toEndWith("(asked by subagent agent-sub1)");
      expect(hookAnswers[2]).toBeUndefined();
      expect(toolTexts.bounced).toContain("apps/api/src/hack.ts");
      expect(q.violations).toEqual([
        expect.objectContaining({
          role: "frontend",
          taskId: "web-shell",
          attempt: 1,
          paths: ["apps/api/src/hack.ts"],
        }),
      ]);
      expect(toolTexts.nudge).toContain("without calling complete_task");
      expect(toolTexts.contract).toContain("// contracts");
      expect(toolTexts.cr).toContain("cr-1");
      expect(toolTexts.bug).toContain("bug-1");

      // Nothing outside a role's paths ever reached integration.
      const integration = `gravita/${squadId}/integration`;
      const commits = new Map(
        h.events("commit.created").map((e) => {
          const d = e.data as { sha: string; role: string; files: string[] };
          return [d.sha, d] as const;
        }),
      );
      const log = (await sh(cwd, h.env, "log", "--no-merges", "--format=%H %s", integration)).split(
        "\n",
      );
      expect(log.length).toBeGreaterThan(plan.tasks.length);
      for (const line of log) {
        const [sha, ...subject] = line.split(" ");
        if (subject.join(" ") === "Gravita: start") continue;
        const commit = commits.get(sha as string);
        expect({ line, known: commit !== undefined }).toEqual({ line, known: true });
        const files = (await sh(cwd, h.env, "show", "--name-only", "--format=", sha as string))
          .split("\n")
          .filter(Boolean);
        expect({ line, outside: outsideOwnership(plan, commit?.role ?? "", files) }).toEqual({
          line,
          outside: [],
        });
      }

      // The phases, in order, and the contract frozen between foundation and build.
      const types = h.events().map((e) => e.type);
      const phases = h
        .events("squad.phase_changed")
        .map((e) => (e.data as { phase: string }).phase);
      expect(phases).toEqual([
        "brief",
        "planning",
        "review",
        "foundation",
        "build",
        "verify",
        "deliver",
      ]);
      const at = (pred: (e: GravitaEvent) => boolean) => h.events().findIndex(pred);
      const phaseAt = (p: string) =>
        at((e) => e.type === "squad.phase_changed" && (e.data as { phase: string }).phase === p);
      expect(at((e) => e.type === "contract.frozen")).toBeGreaterThan(phaseAt("foundation"));
      expect(at((e) => e.type === "contract.frozen")).toBeLessThan(phaseAt("build"));
      expect(q.contracts["packages/contracts/openapi.yaml"]?.version).toBe(1);
      expect(types.indexOf("plan.approved")).toBeLessThan(phaseAt("foundation"));
      expect(q.checks.files?.ok).toBe(true);
      // Foundation tasks ran before any build task.
      const firstRun = (id: string) =>
        at(
          (e) =>
            e.type === "task.status_changed" &&
            (e.data as { taskId: string; status: string }).taskId === id &&
            (e.data as { status: string }).status === "running",
        );
      expect(firstRun("contracts")).toBeLessThan(firstRun("api-store"));
      expect(firstRun("contracts")).toBeLessThan(firstRun("web-shell"));

      // Role sessions: one task per role, at most three at once, with Gravita's options.
      expect(maxRunning).toBeLessThanOrEqual(3);
      expect(maxRunning).toBeGreaterThan(1);
      const role = h.agents.find((a) => a.isRole);
      expect(role?.options).toMatchObject({
        model: "opus",
        permissionMode: "acceptEdits",
        settingSources: ["user", "project", "local"],
      });
      expect(role?.options.env).toMatchObject({
        CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4",
        CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "2",
        GRAVITA_MANAGED: "1",
      });
      expect(role?.options.maxBudgetUsd).toBeGreaterThan(0);
      expect(role?.options.mcpServers?.gravita).toBeDefined();
      expect((role?.options.systemPrompt as { append?: string } | undefined)?.append).toContain(
        "You own",
      );
      for (const s of h.events("session.started"))
        expect((s.data as { kind: string; squadId: string }).kind).toBe("squad");
      expect(h.core.runtimes.all()).toHaveLength(0);

      // Spend: the planner plus every role session's cumulative cost.
      const roleSessions = h.agents.filter((a) => a.isRole).length;
      expect(q.budget.spentUsd).toBeCloseTo(0.4 + 0.1 * roleSessions);
      expect(q.roles.backend?.spentUsd).toBeGreaterThan(0);

      // Deliver into the user's own branch.
      expect(await h.squads.deliver({ squadId, mode: "merge" })).toEqual({ ref: "main" });
      expect(h.squad(squadId).phase).toBe("done");
      expect(h.squad(squadId).delivered?.mode).toBe("merge");
      expect(existsSync(join(cwd, "apps/api/src/index.ts"))).toBe(true);
      expect(existsSync(join(cwd, "packages/contracts/openapi.yaml"))).toBe(true);
      expect(existsSync(join(tmp, "data", "worktrees", projectId, squadId, "backend"))).toBe(false);
      // The branches stay.
      expect(await sh(cwd, h.env, "branch", "--list", `gravita/${squadId}/*`)).toContain(
        "integration",
      );
    });
  }, 60_000);

  test("an existing repository, delivered as a branch", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async (a) => {
        // The briefing says nothing: the test asks for the plan at once.
        if (a.isBriefing) return;
        if (a.isPlanner) return a.result({ structured: testPlan() });
        const prompt = await a.prompt(1);
        await doTheWork(a, await a.taskId(), prompt);
        await finish(a, 0.2);
      });
      const repo = join(tmp, "repo");
      await userRepo(repo, h.env, BASE_FILES);
      const before = await sh(repo, h.env, "rev-parse", "main");
      const { squadId } = await createAndPlan(h, {
        cwd: repo,
        brief: "Demo",
        budgetUsd: 10,
        autonomy: "auto",
      });
      await h.squads.idle(squadId);
      await h.squads.approvePlan({ squadId, plan: h.squad(squadId).plan as SquadPlan });
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);
      expect(h.squad(squadId).phase).toBe("deliver");
      // No foundation tasks: straight to build.
      expect(
        h.events("squad.phase_changed").map((e) => (e.data as { phase: string }).phase),
      ).toEqual(["brief", "planning", "review", "foundation", "build", "verify", "deliver"]);
      expect(await h.squads.deliver({ squadId, mode: "branch" })).toEqual({
        ref: `gravita/${squadId}/integration`,
      });
      // The user's branch is untouched; the work waits on the integration branch.
      expect(await sh(repo, h.env, "rev-parse", "main")).toBe(before);
      expect(
        await sh(repo, h.env, "show", `gravita/${squadId}/integration:apps/web/web-1.ts`),
      ).toBe("// web-1");
    });
  }, 30_000);
});
