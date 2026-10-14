import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SAMPLE_SQUAD_PLAN } from "@gravita/adapter-fake";
import { budgetState, outsideOwnership, squadPlan } from "@gravita/core";
import { RpcErrors, type SquadPlan } from "@gravita/protocol";
import { CODEX_SQUAD_CONFIG } from "../../src/infrastructure/codex/codex-squad-profile";
import { toRpcError } from "../../src/interface/rpc/router";
import type { FakeCodex } from "../codex-squad-fakes";
import { SilentLogger } from "../fakes";
import { sh, testPlan } from "../git-helpers";
import { withTempDir } from "../helpers";
import { rateLimitEvent } from "../sdk-fakes";
import { type ScriptedAgent, squadCore, until } from "../squad-fakes";

// Squads with Codex roles, end to end at no cost: Claude Code sessions are scripted SDK
// queries, Codex sessions are fake app-servers (codex-squad-fakes) that speak the protocol and
// call Gravita's role tools over the real loopback MCP route. Git, the commit gate, the merge
// queue and the checks are real.

const OK = ["node", "-e", "process.exit(0)"];
const PLAN_BUDGET = { mode: "plan", maxPercent: 50, window: "five_hour" } as const;

/** The demo's todo app with the backend on Codex, frontend and tests on Claude Code. */
function mixedPlan(): SquadPlan {
  return {
    ...SAMPLE_SQUAD_PLAN,
    roles: SAMPLE_SQUAD_PLAN.roles.map((r) => ({
      ...r,
      provider: r.id === "backend" ? ("codex" as const) : ("claude" as const),
    })),
    checks: [
      { id: "task-ok", argv: OK, cwd: ".", when: "task" },
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
    questions: [],
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

/** A file for each path the task changes (a folder gets a file named after the task). */
function filesFor(taskId: string, prompt: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const w of writesOf(prompt)) {
    const file = w.endsWith("/")
      ? `${w}${taskId === "contracts" ? "openapi.yaml" : `${taskId}.ts`}`
      : w;
    files[file] = `// ${taskId}\n`;
  }
  return files;
}

/** A Claude role: does its task's work and completes it. */
async function claudeRole(a: ScriptedAgent) {
  const prompt = await a.prompt(1);
  await a.write(filesFor(await a.taskId(), prompt));
  const done = await a.tool("complete_task", { summary: "Done." });
  if (done.isError) throw new Error(`complete_task failed: ${done.text}`);
  a.result({ cost: 0.1 });
}

/** A Codex role: does its task's work, completes it through the loopback MCP, ends the turn. */
async function codexRole(a: FakeCodex) {
  const prompt = await a.prompt(1);
  await a.write(filesFor(await a.taskId(), prompt));
  const done = await a.tool("complete_task", { summary: "Done." });
  if (done.isError) throw new Error(`complete_task failed: ${done.text}`);
  a.endTurn();
}

async function folder(tmp: string) {
  const cwd = join(tmp, "todo");
  await mkdir(cwd, { recursive: true });
  return cwd;
}

describe("squads with Codex roles", () => {
  test("a mixed squad (backend on Codex, frontend and tests on Claude Code) goes from brief to delivery", async () => {
    await withTempDir(async (tmp) => {
      const seen: Record<string, unknown> = {};
      const h = squadCore(
        tmp,
        async (a) => {
          if (a.isBriefing) return;
          if (a.isPlanner) {
            // The planner stays on Claude Code in a mixed squad.
            await a.prompt(1);
            a.q.emit(rateLimitEvent(0.3));
            return a.result({ structured: mixedPlan(), cost: 0.4 });
          }
          return claudeRole(a);
        },
        {
          codex: async (a) => {
            if (!a.isRole) return;
            const taskId = await a.taskId();
            if (taskId === "scaffold-api") {
              a.usage(20);
              // An approval for a file of another role: declined, and the agent hears why.
              seen.outside = await a.requestFileChange([join(a.cwd, "apps/web/src/x.ts")]);
              seen.git = await a.requestCommand("git commit -am wip");
              // Its own file: the autonomy (guarded) allows edits.
              seen.own = await a.requestFileChange([join(a.cwd, "apps/api/src/index.ts")]);
              seen.whoami = (await a.tool("whoami")).text;
              seen.tools = await a.listTools();
              seen.firstToken = a.launch.env.GRAVITA_MCP_TOKEN;
              seen.firstUrl = JSON.parse(a.config("mcp_servers.gravita.url") ?? '""');
              await a.write({ "apps/api/src/index.ts": "export {};\n" });
            }
            if (taskId === "api-routes") a.usage(26);
            await codexRole(a);
          },
        },
      );
      try {
        const cwd = await folder(tmp);
        const { squadId } = await h.squads.create({
          cwd,
          brief: "A todo app",
          budget: PLAN_BUDGET,
          autonomy: "guarded",
          providers: "mixed",
        });
        h.squads.plan({ squadId });
        await h.squads.idle(squadId);
        const proposed = h.squad(squadId);
        expect(proposed.providers).toBe("mixed");
        expect(proposed.phase).toBe("review");
        // The planner was asked to give each role a provider.
        const plannerPrompt = await h.agents.find((a) => a.isPlanner)!.prompt(1);
        expect(plannerPrompt).toContain("mixed squad of Claude Code and Codex agents");

        await h.squads.approvePlan({ squadId, plan: proposed.plan as SquadPlan });
        await h.squads.idle(squadId);
        expect(h.failures).toEqual([]);
        expect(h.codexFailures).toEqual([]);

        const q = h.squad(squadId);
        const plan = squadPlan(q) as SquadPlan;
        expect(q.phase).toBe("deliver");
        for (const t of plan.tasks)
          expect({ t: t.id, s: q.tasks[t.id]?.status }).toEqual({ t: t.id, s: "done" });
        expect(q.violations).toEqual([]);

        // Backend ran on Codex, the others on Claude Code; the planner on Claude Code.
        const started = h.events("session.started");
        const providerOf = (roleId: string) =>
          started
            .filter((e) => (e.data as { roleId?: string }).roleId === roleId)
            .map((e) => e.provider);
        expect(new Set(providerOf("backend"))).toEqual(new Set(["codex"]));
        expect(new Set(providerOf("frontend"))).toEqual(new Set(["claude"]));
        expect(new Set(providerOf("tests"))).toEqual(new Set(["claude"]));
        expect(new Set(providerOf("planner"))).toEqual(new Set(["claude"]));
        for (const e of started.filter((e) => e.provider === "codex"))
          expect(e.sessionId).toStartWith("codex:");

        // Ownership on Codex: the out-of-scope edit and git were declined, with the reason.
        expect(seen.outside).toBe("decline");
        expect(seen.git).toBe("decline");
        expect(seen.own).toBe("accept");
        const scaffold = h.codexAgents.find((a) => a.isRole && a.turns.length > 0)!;
        expect(scaffold.steers[0]).toContain("Gravita declined that:");
        expect(scaffold.steers[0]).toContain("frontend owns apps/web/");
        expect(scaffold.steers[1]).toContain("git commit");
        // Role tools through the loopback MCP: bound to the session's role and task.
        expect(seen.whoami).toContain("backend");
        expect(seen.whoami).toContain("scaffold-api");
        expect(seen.tools).toEqual(
          expect.arrayContaining(["complete_task", "yield_blocked", "report_progress"]),
        );
        // Once the session ended its token is dead.
        const stale = await fetch(seen.firstUrl as string, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${seen.firstToken}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        expect(stale.status).toBe(401);
        expect(h.core.mcp?.size).toBe(0);

        // Isolation: Gravita's Codex home, its role tools only, the worktree as the sandbox.
        const roles = h.codexAgents.filter((a) => a.isRole);
        expect(roles.length).toBeGreaterThanOrEqual(3);
        for (const a of roles) {
          const env = a.launch.env;
          expect(env.CODEX_HOME).toBe(h.codexHome);
          expect(env.OPENAI_API_KEY).toBeUndefined();
          expect(env.GRAVITA_MANAGED).toBe("1");
          expect(env.GRAVITA_MCP_TOKEN).toMatch(/^[0-9a-f]{64}$/);
          expect(a.launch.cwd).toEndWith("/backend");
          expect(a.config("mcp_servers.gravita.bearer_token_env_var")).toBe('"GRAVITA_MCP_TOKEN"');
          expect(a.config("mcp_servers.gravita.default_tools_approval_mode")).toBe('"approve"');
          expect(a.config("mcp_servers.gravita.required")).toBe("true");
          // The token never travels on the command line.
          expect((a.launch.args ?? []).join(" ")).not.toContain(env.GRAVITA_MCP_TOKEN!);
          // Only Gravita's MCP server is added; nothing else is configured per session.
          expect(
            (a.launch.args ?? [])
              .filter((x) => x.startsWith("mcp_servers."))
              .map((x) => x.split(".")[1]),
          ).toEqual(Array(6).fill("gravita"));
          expect(a.threadParams).toMatchObject({
            cwd: a.cwd,
            approvalPolicy: "on-request",
            sandbox: "workspace-write",
          });
          expect(String(a.threadParams?.developerInstructions)).toContain(
            "You own apps/api/, packages/contracts/",
          );
          expect(a.turns[0]).toMatchObject({
            approvalPolicy: "on-request",
            sandboxPolicy: { type: "workspaceWrite", writableRoots: [a.cwd], networkAccess: false },
            model: "gpt-6.1-sol",
          });
        }
        // Model tiers on Codex: foundation tasks at high effort, the others at medium.
        const efforts = Object.fromEntries(
          await Promise.all(roles.map(async (a) => [await a.taskId(), a.turns[0]?.effort])),
        );
        expect(efforts).toMatchObject({
          "scaffold-api": "high",
          contracts: "high",
          "api-store": "medium",
        });
        // Gravita wrote only its config.toml in its Codex home (owner-only).
        expect(readdirSync(h.codexHome)).toEqual(["config.toml"]);
        expect(statSync(h.codexHome).mode & 0o777).toBe(0o700);
        expect(statSync(join(h.codexHome, "config.toml")).mode & 0o777).toBe(0o600);
        expect(await Bun.file(join(h.codexHome, "config.toml")).text()).toBe(CODEX_SQUAD_CONFIG);

        // Plan usage: each provider's window counted from its own baseline; the share is the
        // larger of the two (Codex moved 6 points, Claude Code none).
        const baselines = h
          .events("budget.baseline")
          .map((e) => (e.data as { provider: string; baseline: number }).provider);
        expect(new Set(baselines)).toEqual(new Set(["claude", "codex"]));
        const b = budgetState(q, h.core.projection.usage());
        expect(b.spent).toBeCloseTo(6);

        // Nothing outside a role's paths reached integration, Codex's commits included.
        const commits = h
          .events("commit.created")
          .map((e) => e.data as { sha: string; role: string; files: string[] });
        expect(commits.some((c) => c.role === "backend")).toBe(true);
        for (const c of commits) expect(outsideOwnership(plan, c.role, c.files)).toEqual([]);

        expect(await h.squads.deliver({ squadId, mode: "merge" })).toEqual({ ref: "main" });
        expect(await sh(cwd, h.env, "show", "main:apps/api/src/index.ts")).toBe("// scaffold-api");
        expect(h.core.runtimes.all()).toHaveLength(0);
      } finally {
        h.stop();
      }
    });
  }, 60_000);

  test("Guarded: a Codex role's way out of its sandbox comes to the user, after the guard", async () => {
    await withTempDir(async (tmp) => {
      const seen: Record<string, unknown> = {};
      const h = squadCore(
        tmp,
        async (a) => {
          if (a.isBriefing) return;
          if (a.isPlanner) {
            await a.prompt(1);
            return a.result({ structured: mixedPlan(), cost: 0.4 });
          }
          return claudeRole(a);
        },
        {
          codex: async (a) => {
            if (!a.isRole) return;
            if ((await a.taskId()) === "scaffold-api") {
              const apiFile = join(a.cwd, "apps/api/src/index.ts");
              seen.apiFile = apiFile;
              // An escalated git push: the guard declines it before anyone is asked.
              seen.push = await a.requestCommand("git push origin HEAD", {
                reason: "needs the network",
              });
              // Write access outside the role's paths (as a sandbox entry): declined too.
              seen.foreign = await a.requestPermissions({
                fileSystem: {
                  read: null,
                  write: null,
                  entries: [
                    {
                      path: { type: "path", path: join(a.cwd, "apps/web/src/x.ts") },
                      access: "write",
                    },
                  ],
                },
              });
              // A local command that wants out of the sandbox: the user decides (allows).
              seen.escalated = await a.requestCommand("pnpm --filter api exec tsx src/index.ts", {
                reason: "run outside the sandbox",
              });
              // The network and a read outside the worktree: the user decides (denies).
              seen.denied = await a.requestPermissions(
                {
                  network: { enabled: true },
                  fileSystem: { read: ["/etc/hosts"], write: null },
                },
                "check the API",
              );
              // Its own file and the network: the user allows, so all of it is granted.
              seen.granted = await a.requestPermissions({
                network: { enabled: true },
                fileSystem: {
                  read: null,
                  write: null,
                  entries: [{ path: { type: "path", path: apiFile }, access: "write" }],
                },
              });
            }
            await codexRole(a);
          },
        },
      );
      try {
        const cwd = await folder(tmp);
        const { squadId } = await h.squads.create({
          cwd,
          brief: "A todo app",
          budget: PLAN_BUDGET,
          autonomy: "guarded",
          providers: "mixed",
        });
        h.squads.plan({ squadId });
        await h.squads.idle(squadId);
        await h.squads.approvePlan({ squadId, plan: h.squad(squadId).plan as SquadPlan });

        // The user's answers, in order, to what reaches Needs you.
        const requests = () => h.events("permission.requested");
        const answer = async (n: number, decision: "allow" | "deny") => {
          await until(() => requests().length >= n, `request ${n}`);
          const e = requests()[n - 1]!;
          const { requestId } = e.data as { requestId: string };
          await h.core.runtimes
            .get(e.sessionId ?? "")!
            .respondPermission(e.agentId!, requestId, decision);
          return e;
        };
        const escalated = await answer(1, "allow");
        expect(escalated.provider).toBe("codex");
        expect((escalated.data as { toolName: string }).toolName).toBe("exec_command");
        expect((escalated.data as { inputPreview: string }).inputPreview).toContain(
          "pnpm --filter api exec tsx src/index.ts",
        );
        const denied = await answer(2, "deny");
        expect((denied.data as { inputPreview: string }).inputPreview).toBe(
          "check the API (network access, read /etc/hosts)",
        );
        await answer(3, "allow");
        await h.squads.idle(squadId);
        expect(h.codexFailures).toEqual([]);
        expect(h.squad(squadId).phase).toBe("deliver");

        expect(seen.push).toBe("decline");
        expect(seen.foreign).toEqual({});
        expect(seen.escalated).toBe("accept");
        expect(seen.denied).toEqual({});
        expect(seen.granted).toEqual({
          network: { enabled: true },
          fileSystem: {
            read: null,
            write: null,
            entries: [{ path: { type: "path", path: seen.apiFile }, access: "write" }],
          },
        });
        // Only those three reached the user; the guard's refusals were told to the agent.
        expect(requests()).toHaveLength(3);
        const scaffold = h.codexAgents.find((a) => a.isRole && a.turns.length > 0)!;
        expect(scaffold.steers[0]).toContain("git push");
        expect(scaffold.steers[1]).toContain("frontend owns apps/web/");
      } finally {
        h.stop();
      }
    });
  }, 60_000);

  test("a Codex-only squad briefs and plans on Codex: a read-only sandbox, the plan as structured output", async () => {
    await withTempDir(async (tmp) => {
      const answered: string[] = [];
      const escapes: unknown[] = [];
      const h = squadCore(tmp, async () => {}, {
        codex: async (a) => {
          if (a.isRole) return codexRole(a);
          const first = await a.prompt(1);
          if (a.turns[0]?.outputSchema === undefined) {
            // The briefing: it reads and talks, then the user asks for the plan. Even a read
            // never leaves its read-only sandbox.
            escapes.push(await a.requestCommand("cat README.md", { reason: "escalate" }));
            answered.push(first);
            a.say("I know enough to plan.");
            return a.endTurn();
          }
          // The planner's first answer breaks a rule (a Claude role in a Codex-only squad),
          // with the nulls a strict schema gives for absent fields.
          const bad = testPlan();
          a.say(
            JSON.stringify({
              ...bad,
              roles: bad.roles.map((r) => ({
                ...r,
                model: null,
                budgetUsd: null,
                provider: r.id === "frontend" ? "claude" : null,
              })),
            }),
          );
          a.endTurn();
          const fix = await a.prompt(2);
          answered.push(fix);
          a.say(JSON.stringify(testPlan()));
          a.endTurn();
        },
      });
      try {
        const cwd = await folder(tmp);
        const { squadId } = await h.squads.create({
          cwd,
          brief: "Demo",
          budget: PLAN_BUDGET,
          autonomy: "auto",
          providers: "codex",
        });
        await until(() => answered.length === 1, "the briefing");
        h.squads.plan({ squadId });
        await h.squads.idle(squadId);
        const q = h.squad(squadId);
        expect(q.phase).toBe("review");
        expect(
          h.events("plan.rejected").map((e) => (e.data as { errors: string[] }).errors),
        ).toEqual([[`Role "frontend" runs on Claude Code, but this squad is Codex only.`]]);
        expect(answered[1]).toContain("runs on Claude Code, but this squad is Codex only");
        expect(h.agents).toHaveLength(0);

        const [briefing, planner] = h.codexAgents.filter((a) => a.turns.length > 0);
        expect(briefing?.threadParams).toMatchObject({
          approvalPolicy: "on-request",
          sandbox: "read-only",
        });
        expect(briefing?.turns[0]).toMatchObject({
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          effort: "medium",
        });
        expect(String(briefing?.threadParams?.developerInstructions)).toContain("being briefed");
        expect(escapes).toEqual(["decline"]);
        // The planner resumes the briefing's thread, read-only and never asking.
        expect(planner?.received.find((m) => m.method === "thread/resume")?.params).toMatchObject({
          threadId: briefing?.threadId,
          approvalPolicy: "never",
          sandbox: "read-only",
        });
        const schema = planner?.turns[0]?.outputSchema as Record<string, unknown>;
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required).toEqual(expect.arrayContaining(["roles", "tasks", "questions"]));
        expect(planner?.turns[0]?.effort).toBe("high");
        expect(planner?.turns[1]?.outputSchema).toBeDefined();

        await h.squads.approvePlan({ squadId, plan: q.plan as SquadPlan });
        await h.squads.idle(squadId);
        expect(h.codexFailures).toEqual([]);
        expect(h.squad(squadId).phase).toBe("deliver");
        // Autonomous: never asks, network allowed, still only the worktree writable.
        const role = h.codexAgents.find((a) => a.isRole)!;
        expect(role.threadParams).toMatchObject({ approvalPolicy: "never" });
        expect(role.turns[0]?.sandboxPolicy).toMatchObject({
          writableRoots: [role.cwd],
          networkAccess: true,
        });
      } finally {
        h.stop();
      }
    });
  }, 60_000);

  test("pause and the kill switch stop Codex roles; resuming continues the same thread", async () => {
    await withTempDir(async (tmp) => {
      const firstRuns = new Map<string, FakeCodex>();
      const h = squadCore(tmp, async () => {}, {
        codex: async (a) => {
          if (!a.isRole) return;
          const taskId = await a.taskId();
          if (a.received.some((m) => m.method === "thread/resume")) return codexRole(a);
          firstRuns.set(taskId, a);
          // Works until it is stopped.
          await new Promise<void>(() => {});
        },
      });
      try {
        const cwd = await folder(tmp);
        const plan = testPlan({ roles: testPlan().roles.filter((r) => r.id !== "planner") });
        const created = await h.squads.create({
          cwd,
          brief: "Demo",
          budget: PLAN_BUDGET,
          autonomy: "guarded",
          providers: "codex",
        });
        const { squadId } = created;
        // The briefing (on Codex) says nothing; plan at once with a scripted plan.
        const planner = (a: FakeCodex) => a.turns[0]?.outputSchema !== undefined;
        void (async () => {
          await until(() => h.codexAgents.some((a) => a.turns.length > 0 && planner(a)), "planner");
          const p = h.codexAgents.find((a) => planner(a))!;
          p.say(JSON.stringify(plan));
          p.endTurn();
        })();
        await until(() => h.codexAgents.some((a) => a.turns.length > 0), "the briefing");
        h.codexAgents.find((a) => a.turns.length > 0)!.endTurn();
        h.squads.plan({ squadId });
        await h.squads.idle(squadId);
        await h.squads.approvePlan({ squadId, plan: h.squad(squadId).plan as SquadPlan });
        await until(() => firstRuns.size === 2, "both roles running");

        // Pause: each turn is interrupted (turn/interrupt), the tasks wait to continue.
        h.squads.pause({ squadId });
        await until(
          () => Object.values(h.squad(squadId).tasks).every((t) => t.status === "ready"),
          "tasks back to ready",
        );
        for (const a of firstRuns.values())
          expect(a.received.some((m) => m.method === "turn/interrupt")).toBe(true);
        h.squads.resume({ squadId });
        await h.squads.idle(squadId);
        expect(h.squad(squadId).phase).toBe("deliver");
        // Each task continued in its own Codex thread (thread/resume), in Gravita's home.
        for (const [taskId, first] of firstRuns) {
          const resumed = h.codexAgents.find(
            (a) =>
              a.received.some(
                (m) =>
                  m.method === "thread/resume" &&
                  (m.params as { threadId?: string }).threadId === first.threadId,
              ) && a.isRole,
          );
          expect({ taskId, resumed: resumed !== undefined }).toEqual({ taskId, resumed: true });
          expect(resumed?.launch.env.CODEX_HOME).toBe(h.codexHome);
        }
      } finally {
        h.stop();
      }
    });
  }, 60_000);

  test("the kill switch disposes Codex role sessions and the squad waits, paused", async () => {
    await withTempDir(async (tmp) => {
      let running = 0;
      const h = squadCore(tmp, async () => {}, {
        codex: async (a) => {
          if (!a.isRole) return;
          await a.taskId();
          if (a.received.some((m) => m.method === "thread/resume")) return codexRole(a);
          running++;
          await new Promise<void>(() => {});
        },
      });
      try {
        const cwd = await folder(tmp);
        const plan = testPlan({ roles: testPlan().roles.filter((r) => r.id !== "planner") });
        const { squadId } = await h.squads.create({
          cwd,
          brief: "Demo",
          budget: PLAN_BUDGET,
          autonomy: "auto",
          providers: "codex",
        });
        await until(() => h.codexAgents.some((a) => a.turns.length > 0), "the briefing");
        h.codexAgents.find((a) => a.turns.length > 0)!.endTurn();
        h.squads.plan({ squadId });
        await until(
          () => h.codexAgents.some((a) => a.turns[0]?.outputSchema !== undefined),
          "the planner",
        );
        const p = h.codexAgents.find((a) => a.turns[0]?.outputSchema !== undefined)!;
        p.say(JSON.stringify(plan));
        p.endTurn();
        await h.squads.idle(squadId);
        await h.squads.approvePlan({ squadId, plan: h.squad(squadId).plan as SquadPlan });
        await until(() => running === 2, "both roles running");

        const { stopped } = await h.core.stopAll.execute(1_000);
        expect(stopped).toBeGreaterThanOrEqual(2);
        await until(() => h.squad(squadId).paused !== undefined, "paused");
        expect(h.squad(squadId).paused?.reason).toContain("kill switch");
        h.squads.resume({ squadId });
        await h.squads.idle(squadId);
        expect(h.squad(squadId).phase).toBe("deliver");
      } finally {
        h.stop();
      }
    });
  }, 60_000);

  test("Codex's plan usage feeds the squad's share: over it, the squad pauses and its Codex sessions stop", async () => {
    await withTempDir(async (tmp) => {
      // The user's own Codex (maybe another ChatGPT account) reports its own windows.
      const userReading = (usedPercent: number) => ({
        key: `usage:codex:five_hour:user:${usedPercent}`,
        ts: h.clock.iso(),
        source: "codex-rollout" as const,
        provider: "codex" as const,
        projectId: "",
        type: "usage.limits" as const,
        data: { provider: "codex" as const, window: "five_hour" as const, usedPercent },
      });
      const h = squadCore(tmp, async () => {}, {
        codex: async (a) => {
          if (!a.isRole) return;
          await a.taskId();
          if (a.cwd.endsWith("/backend") && !a.received.some((m) => m.method === "thread/resume")) {
            h.core.ingest.execute([userReading(5)]);
            a.usage(20);
            await until(() => h.events("budget.baseline").length > 0, "a baseline");
            // Never counted for the squad, however much the user's own account uses.
            h.core.ingest.execute([userReading(97)]);
            a.usage(28); // 8 points: 80% of a 10% share, a warning
            a.usage(31); // 11: over it
          }
          await new Promise<void>(() => {});
        },
      });
      try {
        const cwd = await folder(tmp);
        const plan = testPlan({ roles: testPlan().roles.filter((r) => r.id !== "planner") });
        const { squadId } = await h.squads.create({
          cwd,
          brief: "Demo",
          budget: { mode: "plan", maxPercent: 10, window: "five_hour" },
          autonomy: "auto",
          providers: "codex",
        });
        await until(() => h.codexAgents.some((a) => a.turns.length > 0), "the briefing");
        h.codexAgents.find((a) => a.turns.length > 0)!.endTurn();
        h.squads.plan({ squadId });
        await until(
          () => h.codexAgents.some((a) => a.turns[0]?.outputSchema !== undefined),
          "the planner",
        );
        const p = h.codexAgents.find((a) => a.turns[0]?.outputSchema !== undefined)!;
        p.say(JSON.stringify(plan));
        p.endTurn();
        await h.squads.idle(squadId);
        await h.squads.approvePlan({ squadId, plan: h.squad(squadId).plan as SquadPlan });
        await until(() => h.squad(squadId).paused !== undefined, "paused");
        expect(h.squad(squadId).paused?.reason).toContain("share of your 5-hour window");
        const levels = h
          .events()
          .filter((e) => e.type === "budget.warned" || e.type === "budget.exhausted");
        expect(levels.map((e) => e.type)).toEqual(["budget.warned", "budget.exhausted"]);
        expect(levels.map((e) => e.data)).toMatchObject([
          { provider: "codex", used: 8 },
          { provider: "codex", used: 11 },
        ]);
        expect(h.events("budget.baseline").map((e) => e.data)).toMatchObject([
          { provider: "codex", baseline: 20 },
        ]);
        // The squad sessions' readings are the profile's; the user's stay theirs (Home's).
        const usage = h.core.projection.usage();
        expect(usage["codex:squadProfile:five_hour"]).toMatchObject({
          account: "squadProfile",
          usedPercent: 31,
        });
        expect(usage["codex:five_hour"]?.usedPercent).toBe(97);
        await until(
          () =>
            h.codexAgents
              .filter((a) => a.isRole && a.turns.length > 0)
              .every((a) => a.received.some((m) => m.method === "turn/interrupt")),
          "the Codex sessions interrupted",
        );
      } finally {
        h.stop();
      }
    });
  }, 60_000);

  test("Codex roles need Gravita's Codex profile signed in, and a share of the plan", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async () => {}, {
        codex: async (a) => {
          // The profile's account read: nobody signed in yet.
          a.signedIn = false;
        },
      });
      try {
        const cwd = await folder(tmp);
        const signedOut = await h.squads
          .create({ cwd, brief: "Demo", budget: PLAN_BUDGET, autonomy: "auto", providers: "mixed" })
          .catch((e: unknown) => e);
        expect(toRpcError(signedOut, new SilentLogger(), "squad.create")).toMatchObject({
          code: RpcErrors.codexProfileSignedOut.code,
          data: { provider: "codex" },
        });
        expect((signedOut as Error).message).toContain("Sign in to Codex for squads");
        const dollars = await h.squads
          .create({ cwd, brief: "Demo", budgetUsd: 10, autonomy: "auto", providers: "codex" })
          .catch((e: unknown) => e);
        expect((dollars as Error).message).toContain("measured in plan usage");
        // Claude Code only needs neither.
        await h.squads.create({ cwd, brief: "Demo", budgetUsd: 10, autonomy: "auto" });
        expect(h.squads).toBeDefined();
      } finally {
        h.stop();
      }
    });
  });
});
