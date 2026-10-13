import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { MAIN_AGENT, RpcErrors, squadPlanJsonSchema } from "@gravita/protocol";
import { BRIEFING_CHARTER, PLANNER_CHARTER } from "../../src/application/squad/prompts";
import { judgePlan } from "../../src/application/squad/run-planner";
import { DirtyWorktreeError, SquadPhaseError } from "../../src/domain/errors";
import { BASE_FILES, testPlan, userRepo, writeFiles } from "../git-helpers";
import { withTempDir } from "../helpers";
import { type ScriptedAgent, squadCore, until } from "../squad-fakes";

const overlapping = () => {
  const p = testPlan();
  return {
    ...p,
    roles: p.roles.map((r) => (r.id === "frontend" ? { ...r, owns: ["apps/"] } : r)),
  };
};

async function emptyFolder(tmp: string) {
  const cwd = join(tmp, "todo");
  await mkdir(cwd, { recursive: true });
  return cwd;
}

const create = (cwd: string) => ({
  cwd,
  brief: "A todo app",
  budgetUsd: 30,
  autonomy: "guarded" as const,
});

const ask = (canUseTool: CanUseTool | undefined, tool: string, input = {}, requestId = "r") =>
  canUseTool?.(tool, input, {
    signal: new AbortController().signal,
    toolUseID: `toolu_${requestId}`,
    requestId,
  });

/** The briefing answers its first message (the brief), costing `cost`. */
async function answerBrief(a: ScriptedAgent, cost = 0.1) {
  await a.prompt(1);
  a.result({ cost });
}

describe("briefing", () => {
  test("creating a squad starts a read-only conversation with the planner, the brief first", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async (a) => {
        if (a.isBriefing) await answerBrief(a, 0.05);
      });
      const cwd = await emptyFolder(tmp);
      const { squadId } = await h.squads.create(create(cwd));
      await until(() => h.squad(squadId).budget.spentUsd > 0, "the briefing's first answer");
      expect(h.failures).toEqual([]);

      const q = h.squad(squadId);
      expect(q.phase).toBe("brief");
      expect(h.events("squad.phase_changed").map((e) => e.data)).toEqual([
        { squadId, phase: "brief" },
      ]);
      expect(h.agents).toHaveLength(1);
      const briefing = h.agents[0] as ScriptedAgent;
      expect(briefing.isBriefing).toBe(true);
      expect(await briefing.prompt(1)).toBe("A todo app");
      const o = briefing.options;
      expect(o).toMatchObject({
        tools: ["Read", "Grep", "Glob", "AskUserQuestion"],
        disallowedTools: ["Write", "Edit", "NotebookEdit", "Bash", "MultiEdit"],
        // Not dontAsk: that would deny AskUserQuestion before it reaches the user.
        permissionMode: "default",
        // Automatic: the conversation runs on Sonnet (the plan itself on Opus).
        model: "sonnet",
        maxTurns: 30,
        // A twentieth of $30, at least $0.50.
        maxBudgetUsd: 1.5,
        systemPrompt: { type: "preset", preset: "claude_code", append: BRIEFING_CHARTER },
        cwd,
      });
      expect(o.outputFormat).toBeUndefined();
      expect(o.mcpServers).toBeUndefined();
      expect(o.hooks).toBeUndefined();
      // Reading is allowed, anything else denied (the tool list already leaves writes out).
      expect(await ask(o.canUseTool, "Read")).toMatchObject({ behavior: "allow" });
      for (const tool of ["Bash", "Write", "Edit", "WebFetch"])
        expect(await ask(o.canUseTool, tool)).toMatchObject({ behavior: "deny" });

      // The planner role's session, controllable like a chat, and its spend is the squad's.
      const sessionId = o.sessionId as string;
      expect(h.events("session.started")[0]?.data).toMatchObject({
        kind: "squad",
        squadId,
        roleId: "planner",
        cwd,
        model: "sonnet",
      });
      expect(h.events("message.user")[0]?.data).toMatchObject({
        textPreview: "A todo app",
        origin: "gravita",
      });
      expect(h.core.runtimes.get(sessionId)).toBeDefined();
      expect(q.roles.planner?.currentSessionId).toBe(sessionId);
      expect(q.budget.spentUsd).toBeCloseTo(0.05);
      expect(q.planStatus).toBe("none");

      await h.squads.stop({ squadId });
      expect(h.core.runtimes.all()).toHaveLength(0);
    });
  });

  test("the user talks to the briefing through session.send, and its questions reach them", async () => {
    await withTempDir(async (tmp) => {
      const said: string[] = [];
      const h = squadCore(tmp, async (a) => {
        if (!a.isBriefing) return;
        await answerBrief(a);
        said.push(await a.prompt(2));
        a.result({ cost: 0.2 });
      });
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      const briefing = h.agents[0] as ScriptedAgent;
      const sessionId = briefing.options.sessionId as string;

      expect(
        await h.core.router.dispatch("session.send", { sessionId, text: "Keep it offline" }),
      ).toEqual({ result: { ok: true } });
      await until(() => said.length === 1, "the user's message");
      expect(said[0]).toBe("Keep it offline");

      // AskUserQuestion goes to the user as a question, and their answer goes back.
      const questions = [
        {
          question: "Where should todos be stored?",
          header: "Storage",
          multiSelect: false,
          options: [{ label: "In the browser" }, { label: "In a database" }],
        },
      ];
      const decision = ask(briefing.options.canUseTool, "AskUserQuestion", { questions }, "q1");
      await until(() => h.events("question.asked").length === 1, "the question");
      const asked = h.events("question.asked")[0];
      expect(asked?.sessionId).toBe(sessionId);
      expect(asked?.data).toMatchObject({ requestId: "q1", questions });
      expect(
        await h.core.router.dispatch("question.answer", {
          sessionId,
          agentId: MAIN_AGENT,
          requestId: "q1",
          answers: { "Where should todos be stored?": "In the browser" },
        }),
      ).toEqual({ result: { ok: true } });
      expect(await decision).toMatchObject({
        behavior: "allow",
        updatedInput: { answers: { "Where should todos be stored?": "In the browser" } },
      });
      expect(h.squad(squadId).phase).toBe("brief");
      await h.squads.stop({ squadId });
    });
  });
});

describe("planner", () => {
  test("squad.plan resumes the briefing with structured output; an invalid plan is fixed in the same session, then proposed", async () => {
    await withTempDir(async (tmp) => {
      const prompts: string[] = [];
      const h = squadCore(tmp, async (a: ScriptedAgent) => {
        if (a.isBriefing) return answerBrief(a, 0.1);
        prompts.push(await a.prompt(1));
        a.result({ structured: overlapping(), cost: 0.2 });
        prompts.push(await a.prompt(2));
        a.result({ structured: testPlan(), cost: 0.5 });
      });
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      await until(() => h.squad(squadId).budget.spentUsd > 0, "the briefing's answer");
      h.squads.plan({ squadId });
      expect(h.squad(squadId).phase).toBe("planning");
      // A second click is refused.
      expect(() => h.squads.plan({ squadId })).toThrow(SquadPhaseError);
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);

      const q = h.squad(squadId);
      expect(q.phase).toBe("review");
      expect(q.planStatus).toBe("proposed");
      expect(q.planAttempts).toBe(2);
      expect(q.models).toEqual({
        mode: "auto",
        briefing: "sonnet",
        planner: "opus",
        roles: "sonnet",
      });
      expect(q.baseBranch).toBe("main");
      const rejected = h.events("plan.rejected")[0];
      expect(rejected?.data).toMatchObject({ attempt: 1 });
      const errors = (rejected?.data as { errors: string[] } | undefined)?.errors ?? [];
      expect(errors[0]).toContain('Roles "backend" and "frontend" overlap');
      // The errors went back to the planner as its next message.
      expect(prompts[1]).toContain(errors[0] as string);
      expect(prompts[0]).toContain("Now produce the SquadPlan from everything above");
      expect(
        h
          .events()
          .map((e) => e.type)
          .filter((t) => t.startsWith("plan") || t.startsWith("squad")),
      ).toEqual([
        "squad.created",
        "squad.phase_changed",
        "squad.phase_changed",
        "plan.rejected",
        "plan.proposed",
        "squad.phase_changed",
      ]);
      expect(
        h.events("squad.phase_changed").map((e) => (e.data as { phase: string }).phase),
      ).toEqual(["brief", "planning", "review"]);

      // The planner continued the briefing's own session: same id, its transcript resumed.
      expect(h.agents).toHaveLength(2);
      const [briefing, planner] = h.agents as [ScriptedAgent, ScriptedAgent];
      const sessionId = briefing.options.sessionId as string;
      expect(planner.isPlanner).toBe(true);
      expect(planner.options.resume).toBe(sessionId);
      expect(planner.options.sessionId).toBeUndefined();
      // The briefing was between turns: closed, not interrupted.
      expect(briefing.q.calls).not.toContain("interrupt");
      expect(briefing.q.closed).toBe(true);
      // One session, so its spend is the latest cumulative cost; it counts for the squad.
      expect(q.budget.spentUsd).toBeCloseTo(0.5);
      expect(q.roles.planner?.sessionIds).toEqual([sessionId]);
      expect(h.core.runtimes.all()).toHaveLength(0);

      // Asking for a plan again is only for a squad being briefed.
      expect(await h.core.router.dispatch("squad.plan", { squadId })).toEqual({
        error: {
          code: RpcErrors.squadPhase.code,
          message: "A plan can be asked for only while the squad is being briefed.",
        },
      });
    });
  });

  test("the planning run is read-only, structured and on Opus, with what the briefing spent on top of its slice", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async (a) => {
        if (a.isBriefing) return answerBrief(a, 0.4);
        a.result({ structured: testPlan() });
      });
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      await until(() => h.squad(squadId).budget.spentUsd > 0, "the briefing's answer");
      h.squads.plan({ squadId });
      await h.squads.idle(squadId);
      const o = h.agents[1]?.options;
      expect(o).toMatchObject({
        tools: ["Read", "Grep", "Glob"],
        disallowedTools: ["Write", "Edit", "NotebookEdit", "Bash", "MultiEdit"],
        permissionMode: "dontAsk",
        outputFormat: { type: "json_schema", schema: squadPlanJsonSchema() },
        model: "opus",
        maxTurns: 30,
        // A tenth of $30 (at least $1), plus the $0.40 the resumed session already spent.
        maxBudgetUsd: 3.4,
        systemPrompt: { type: "preset", preset: "claude_code", append: PLANNER_CHARTER },
      });
      expect(o?.mcpServers).toBeUndefined();
      expect(o?.hooks).toBeUndefined();
      // It never asks the user: anything but reading is denied.
      expect(await ask(o?.canUseTool, "Bash")).toMatchObject({ behavior: "deny" });
      expect(await ask(o?.canUseTool, "AskUserQuestion")).toMatchObject({ behavior: "deny" });
      expect(await ask(o?.canUseTool, "Read")).toMatchObject({ behavior: "allow" });
    });
  });

  test("asking for the plan while the briefing is answering interrupts that turn first", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async (a) => {
        // The briefing never ends its turn by itself.
        if (a.isBriefing) return void (await a.prompt(1));
        a.result({ structured: testPlan() });
      });
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      h.squads.plan({ squadId });
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);
      const [briefing, planner] = h.agents as [ScriptedAgent, ScriptedAgent];
      expect(briefing.q.calls.slice(0, 2)).toEqual(["interrupt", "close"]);
      expect(planner.options.resume).toBe(briefing.options.sessionId);
      expect(h.squad(squadId).phase).toBe("review");
    });
  });

  test("three invalid plans fail the squad with the reason", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async (a) => {
        if (a.isBriefing) return answerBrief(a);
        for (let n = 1; n <= 3; n++) {
          await a.prompt(n);
          a.result({ structured: n === 2 ? { goal: "not a plan" } : overlapping() });
        }
      });
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      h.squads.plan({ squadId });
      await h.squads.idle(squadId);
      const q = h.squad(squadId);
      expect(q.phase).toBe("failed");
      expect(q.phaseReason).toContain("couldn't produce a valid plan in 3 tries");
      expect(h.events("plan.rejected").map((e) => (e.data as { attempt: number }).attempt)).toEqual(
        [1, 2, 3],
      );
      expect(h.events("plan.proposed")).toHaveLength(0);
    });
  });

  test("replan resumes the planner's session with the user's feedback", async () => {
    await withTempDir(async (tmp) => {
      const prompts: string[] = [];
      const h = squadCore(tmp, async (a) => {
        if (a.isBriefing) return answerBrief(a);
        prompts.push(await a.prompt(1));
        a.result({ structured: testPlan() });
      });
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      h.squads.plan({ squadId });
      await h.squads.idle(squadId);
      await h.squads.replan({ squadId, feedback: "Split the web app into two tasks" });
      await h.squads.idle(squadId);
      expect(prompts[1]).toContain("Split the web app into two tasks");
      expect(prompts[1]).toContain("Your previous plan");
      expect(h.squad(squadId)).toMatchObject({ phase: "review", planAttempts: 2 });
      const sessionId = h.agents[0]?.options.sessionId;
      expect(h.agents.slice(1).map((a) => a.options.resume)).toEqual([sessionId, sessionId]);
    });
  });

  test("a session Claude Code can't resume falls back to a fresh planner with the briefing", async () => {
    await withTempDir(async (tmp) => {
      const prompts: string[] = [];
      const h = squadCore(tmp, async (a) => {
        if (a.isBriefing) return answerBrief(a);
        // The resumed session ends at once (no transcript to go on).
        if (a.options.resume) return a.q.end();
        prompts.push(await a.prompt(1));
        a.result({ structured: testPlan() });
      });
      const { squadId } = await h.squads.create(create(await emptyFolder(tmp)));
      await until(() => h.squad(squadId).budget.spentUsd > 0, "the briefing's answer");
      h.squads.plan({ squadId });
      await h.squads.idle(squadId);
      expect(h.failures).toEqual([]);
      expect(h.squad(squadId).phase).toBe("review");
      expect(h.agents).toHaveLength(3);
      expect(h.agents[2]?.options.resume).toBeUndefined();
      expect(prompts[0]).toContain("The user's brief:\nA todo app");
      expect(prompts[0]).toContain("Before planning, you talked with the user");
    });
  });

  test("after a restart in the brief, messages are refused and squad.plan starts a fresh planner with the conversation", async () => {
    await withTempDir(async (tmp) => {
      const dbPath = join(tmp, "gravita.db");
      const first = squadCore(
        tmp,
        async (a) => {
          await answerBrief(a, 0.1);
          await a.prompt(2);
          a.result({ cost: 0.3 });
        },
        { dbPath },
      );
      const { squadId } = await first.squads.create(create(await emptyFolder(tmp)));
      const sessionId = first.agents[0]?.options.sessionId as string;
      await first.core.router.dispatch("session.send", {
        sessionId,
        text: "Store todos in the browser",
      });
      await until(() => first.squad(squadId).budget.spentUsd >= 0.3, "the second answer");

      // The engine "crashes": a new one opens the same database.
      const prompts: string[] = [];
      const second = squadCore(
        tmp,
        async (a) => {
          prompts.push(await a.prompt(1));
          a.result({ structured: testPlan(), cost: 0.2 });
        },
        { dbPath },
      );
      second.squads.recover();
      expect(second.squad(squadId)).toMatchObject({ phase: "brief" });
      expect(second.squad(squadId).paused).toBeUndefined();
      expect(
        await second.core.router.dispatch("session.send", { sessionId, text: "Still there?" }),
      ).toEqual({ error: RpcErrors.notControllable });

      second.squads.plan({ squadId });
      await second.squads.idle(squadId);
      expect(second.failures).toEqual([]);
      expect(second.squad(squadId).phase).toBe("review");
      expect(second.agents).toHaveLength(1);
      const planner = second.agents[0] as ScriptedAgent;
      expect(planner.isPlanner).toBe(true);
      expect(planner.options.resume).toBeUndefined();
      expect(planner.options.sessionId).not.toBe(sessionId);
      // The brief, and what was said (Gravita's previews: there's no transcript here).
      expect(prompts[0]).toContain("The user's brief:\nA todo app");
      expect(prompts[0]).toContain("User: Store todos in the browser");
      // Both sessions count for the squad.
      expect(second.squad(squadId).budget.spentUsd).toBeCloseTo(0.5);

      first.squads.close();
      await first.core.disposeRuntimes(100);
    });
  });

  test("a folder with files that isn't a repository, or a dirty repository, is refused before any spend", async () => {
    await withTempDir(async (tmp) => {
      const h = squadCore(tmp, async () => {});
      const loose = join(tmp, "loose");
      await writeFiles(loose, { "a.txt": "x" });
      await expect(h.squads.create(create(loose))).rejects.toThrow("isn't a git repository");
      await expect(h.squads.create(create(join(tmp, "missing")))).rejects.toThrow("doesn't exist");
      const repo = join(tmp, "repo");
      await userRepo(repo, h.env, BASE_FILES);
      await writeFiles(repo, { "scratch.txt": "wip" });
      await expect(h.squads.create(create(repo))).rejects.toBeInstanceOf(DirtyWorktreeError);
      expect(h.agents).toHaveLength(0);
      expect(h.events("squad.created")).toHaveLength(0);
    });
  });

  test("judgePlan: shape problems name the field, meaning problems use the validator", () => {
    expect(judgePlan(undefined).errors[0]).toContain("structured output");
    expect(judgePlan({ goal: "x" }).errors.some((e) => e.startsWith("summary:"))).toBe(true);
    expect(judgePlan(testPlan())).toEqual({ plan: testPlan(), errors: [] });
  });
});
