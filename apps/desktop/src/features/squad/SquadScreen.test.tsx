import { AUTO_MODELS, estimatePlanCost, MODEL_CHOICES, type SquadState } from "@gravita/core";
import type { SquadModels } from "@gravita/protocol";
import { RpcErrors } from "@gravita/protocol/constants";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GatewayError } from "@/infrastructure/engine/GatewayError";
import { setLocale } from "@/shared/i18n/i18n";
import { usd } from "@/shared/presenters/money";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { PLAN, PROJECT, SQ, type SquadFixture, squadFixture } from "@/test/squadFixtures";
import SquadScreen from "./SquadScreen";

afterEach(cleanup);
setLocale("en");
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());

async function renderSquad(
  kind: SquadFixture,
  opts: {
    taskId?: string;
    gateway?: FakeGateway;
    models?: SquadModels;
    edit?: (q: SquadState) => void;
  } = {},
) {
  const data = squadFixture(kind);
  const q = data.state.squads?.[SQ];
  if (q && opts.models) q.models = opts.models;
  if (q) opts.edit?.(q);
  const gateway = opts.gateway ?? new FakeGateway();
  gateway.conversationResult = { messages: data.conversation };
  const view = renderWithApp(
    <SquadScreen
      projectId={PROJECT}
      squadId={SQ}
      {...(opts.taskId ? { taskId: opts.taskId } : {})}
    />,
    { state: data.state, gateway },
  );
  await act(async () => {
    await flush();
    await flush();
  });
  return view;
}

const click = async (name: string | RegExp, scope: HTMLElement = document.body) => {
  await act(async () => {
    fireEvent.click(within(scope).getByRole("button", { name }));
    await flush();
  });
};

describe("Brief", () => {
  it("talks with the planner and asks for the plan once it has replied", async () => {
    const { gateway } = await renderSquad("brief");
    expect(screen.getAllByText("Planner").length).toBeGreaterThan(0);
    expect(await screen.findByText(/Ready to write the plan/)).toBeTruthy();
    const generate = screen.getByRole("button", { name: "Generate plan" }) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    await click("Generate plan");
    expect(gateway.callsOf("planSquad")).toEqual([{ squadId: SQ }]);
  });

  it("names the squad's model choice, or an older squad's mix", async () => {
    await renderSquad("brief", { models: { ...AUTO_MODELS } });
    expect(screen.getByText("Automatic")).toBeTruthy();
    cleanup();
    await renderSquad("brief");
    expect(screen.getByText("opus plans, sonnet builds")).toBeTruthy();
  });

  it("keeps Generate plan off until the planner has said something", async () => {
    const gateway = new FakeGateway();
    const data = squadFixture("brief");
    gateway.conversationResult = { messages: data.conversation.slice(0, 1) };
    renderWithApp(<SquadScreen projectId={PROJECT} squadId={SQ} />, { state: data.state, gateway });
    await act(async () => {
      await flush();
      await flush();
    });
    gateway.conversationResult = { messages: data.conversation.slice(0, 1) };
    expect(
      (screen.getByRole("button", { name: "Generate plan" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("says the planner is planning, and why an earlier try was sent back", async () => {
    await renderSquad("planning");
    expect(screen.getByText("Planning…")).toBeTruthy();
    expect(screen.getByText(/each path needs a single owner/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate plan" })).toBeNull();
  });
});

describe("Board", () => {
  const OPUS_MARK = "Runs on Opus: this one matters most to get right.";

  it("estimates with the squad's model policy and marks the tasks that run on Opus", async () => {
    await renderSquad("review", { models: { ...AUTO_MODELS } });
    const est = estimatePlanCost(PLAN, AUTO_MODELS);
    expect(screen.getByText(`≈ ${usd(est.totalUsd)}`)).toBeTruthy();
    const byModel = screen.getByRole("list", { name: "The estimate by model" });
    expect(byModel.textContent).toContain(`Opus ≈ ${usd(est.byModel.opus ?? 0)}`);
    expect(byModel.textContent).toContain(`Sonnet ≈ ${usd(est.byModel.sonnet ?? 0)}`);
    // The two foundation tasks (the scaffold and the contract) run on Opus.
    const marked = screen
      .getAllByTitle(OPUS_MARK)
      .map((m) => m.closest("li")?.querySelector("h4")?.textContent);
    expect(marked).toEqual(["Scaffold the API", "Todo API contract"]);
  });

  it("marks nothing and splits nothing when one model runs everything", async () => {
    await renderSquad("review", { models: { ...MODEL_CHOICES.opus } });
    const est = estimatePlanCost(PLAN, MODEL_CHOICES.opus);
    expect(screen.getByText(`≈ ${usd(est.totalUsd)}`)).toBeTruthy();
    expect(est.totalUsd).toBeGreaterThan(estimatePlanCost(PLAN, AUTO_MODELS).totalUsd);
    expect(screen.queryAllByTitle(OPUS_MARK)).toEqual([]);
    expect(screen.queryByRole("list", { name: "The estimate by model" })).toBeNull();
  });

  it("sends the answers to the planner's questions with the approval", async () => {
    const { gateway } = await renderSquad("review");
    fireEvent.change(screen.getByLabelText(PLAN.questions[0] as string), {
      target: { value: "Keep them visible" },
    });
    await click("Approve and start");
    expect(gateway.callsOf("approvePlan")).toEqual([
      {
        squadId: SQ,
        plan: PLAN,
        answers: { [PLAN.questions[0] as string]: "Keep them visible" },
      },
    ]);
  });

  it("renames a task and approves the edited plan", async () => {
    const { gateway } = await renderSquad("review");
    await click("Edit Todo routes");
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "REST routes" } });
    await click("Save");
    expect(screen.getByText("REST routes")).toBeTruthy();
    await click("Approve and start");
    const sent = gateway.callsOf("approvePlan")[0] as { plan: typeof PLAN };
    expect(sent.plan.tasks.find((t) => t.id === "api-routes")?.title).toBe("REST routes");
  });

  it("removes a task and frees the tasks that waited for it", async () => {
    await renderSquad("review");
    await click("Remove Web app shell");
    expect(screen.getByText(/These will stop waiting for it: Todo list UI/)).toBeTruthy();
    await click("Remove task");
    expect(screen.queryByText("Web app shell")).toBeNull();
    expect(screen.getByText("No longer waits for “Web app shell”.")).toBeTruthy();
  });

  it("moves a task only to a role that owns its paths, and says why not", async () => {
    await renderSquad("review");
    await click("Move Todo list UI to another role");
    await click(/Backend$/);
    expect(screen.getByText(/Backend doesn't own every path this task changes/)).toBeTruthy();
    expect(screen.getByText("apps/web/src/components/", { selector: "span" })).toBeTruthy();
  });

  it("pins validation issues to the card and holds Approve until they're fixed", async () => {
    const data = squadFixture("review");
    const q = data.state.squads[SQ];
    if (!q?.plan) throw new Error("fixture");
    // A planner slip: the tests role writes inside the backend's folder.
    q.plan = {
      ...q.plan,
      tasks: q.plan.tasks.map((t) =>
        t.id === "tests-api" ? { ...t, writes: ["apps/api/test/"] } : t,
      ),
    };
    renderWithApp(<SquadScreen projectId={PROJECT} squadId={SQ} />, { state: data.state });
    await act(flush);
    const approve = screen.getByRole("button", { name: "Approve and start" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByText("Fix 1 problem in the plan first.")).toBeTruthy();
    const card = screen.getByRole("heading", { name: "API tests" }).closest("li") as HTMLElement;
    expect(within(card).getAllByText(/apps\/api\/test\//)).toHaveLength(2);
    // Removing the offending task clears the issue.
    await click("Remove API tests");
    await click("Remove task");
    expect(
      (screen.getByRole("button", { name: "Approve and start" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("asks for a new plan with feedback", async () => {
    const { gateway } = await renderSquad("review");
    await click("Replan with feedback");
    fireEvent.change(screen.getByLabelText("What should the planner change?"), {
      target: { value: "One role for the web and the tests" },
    });
    await click("Ask for a new plan");
    expect(gateway.callsOf("replanSquad")).toEqual([
      { squadId: SQ, feedback: "One role for the web and the tests" },
    ]);
  });
});

describe("Run", () => {
  it("draws the squad's map and puts the stuck task first in the column", async () => {
    await renderSquad("run");
    expect(screen.getByRole("group", { name: /The squad's map/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /API tests · waiting for you · Tests/ }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "1 thing needs you" })).toBeTruthy();
  });

  it("retries a stuck task, with a stronger model too", async () => {
    const { gateway } = await renderSquad("run");
    await click("Retry");
    await click("Retry with Opus");
    expect(gateway.callsOf("retryTask")).toEqual([
      { squadId: SQ, taskId: "tests-api" },
      { squadId: SQ, taskId: "tests-api", model: "opus" },
    ]);
  });

  it("offers no stronger model when the policy already stepped the task up to Opus", async () => {
    await renderSquad("run", {
      models: { ...AUTO_MODELS },
      edit: (q) => {
        const task = q.tasks["tests-api"];
        if (task) task.struggled = [1];
      },
    });
    await click("Retry");
    expect(screen.queryByRole("button", { name: "Retry with Opus" })).toBeNull();
  });

  it("skips a stuck task after a confirmation", async () => {
    const { gateway } = await renderSquad("run");
    await click("Skip");
    expect(gateway.callsOf("skipTask")).toEqual([]);
    await click("Skip task");
    expect(gateway.callsOf("skipTask")).toEqual([{ squadId: SQ, taskId: "tests-api" }]);
  });

  it("offers reassigning only to roles that own the task's paths", async () => {
    const { gateway } = await renderSquad("run");
    await click("Reassign");
    expect(screen.getByText(/No other role owns every path it changes/)).toBeTruthy();
    expect(gateway.callsOf("reassignTask")).toEqual([]);
  });

  it("opens a task's story from its station", async () => {
    const { navigate } = await renderSquad("run");
    await click(/Todo storage · running · Backend/);
    expect(navigate).toHaveBeenCalledWith({
      level: "squad",
      projectId: PROJECT,
      squadId: SQ,
      taskId: "api-store",
    });
  });

  it("tells the story of a task that went wrong", async () => {
    await renderSquad("run", { taskId: "tests-api" });
    expect(screen.getByText(/changed files outside this role's folders/)).toBeTruthy();
    expect(screen.getByText("apps/api/src/app.ts")).toBeTruthy();
    expect(screen.getByText("Try 2: the merge conflicted in")).toBeTruthy();
  });

  it("resumes a squad out of budget with a higher budget", async () => {
    const { gateway } = await renderSquad("budget");
    expect(screen.getByText("Paused: the budget is used up.")).toBeTruthy();
    const input = screen.getByLabelText("New budget") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    await click("Resume with a higher budget");
    expect(screen.getByText(/must be above what's spent/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "40" } });
    await click("Resume with a higher budget");
    expect(gateway.callsOf("resumeSquad")).toEqual([{ squadId: SQ, budgetUsd: 40 }]);
  });

  it("a plan squad's meter counts points of its share, measuring until its baseline", async () => {
    const asPlan = (q: SquadState) => {
      q.budgetUsd = 0;
      q.budgetPlan = { maxPercent: 20, window: "seven_day" };
    };
    const { gateway } = await renderSquad("run", { edit: asPlan });
    expect(screen.getAllByText("measuring…").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Measuring: the squad may use 20 points of your weekly limit/),
    ).toBeTruthy();
    // An open squad keeps plan usage fresh.
    expect(gateway.callsOf("refreshUsage")).toEqual([{ provider: "claude" }]);
    cleanup();
    await renderSquad("run", {
      edit: (q) => {
        asPlan(q);
        q.budget.meters = {
          "claude:seven_day": {
            provider: "claude",
            window: "seven_day",
            baseline: 30,
            carried: 0,
            last: 36,
            round: 1,
            savedRound: 1,
          },
        };
      },
    });
    expect(screen.getByText("6 of 20 points of your weekly limit used")).toBeTruthy();
    expect(screen.getByText("/ 20 pts")).toBeTruthy();
    expect(screen.getByText("6 of 20 pts")).toBeTruthy();
    expect(screen.getByText(/other use of the account counts too/)).toBeTruthy();
  });

  it("resumes a plan squad that used its share with a bigger share", async () => {
    const { gateway } = await renderSquad("budget", {
      edit: (q) => {
        q.budgetUsd = 0;
        q.budgetPlan = { maxPercent: 20, window: "seven_day" };
        q.budget.meters = {
          "claude:seven_day": {
            provider: "claude",
            window: "seven_day",
            baseline: 30,
            carried: 0,
            last: 51,
            round: 1,
            savedRound: 1,
          },
        };
      },
    });
    expect(screen.getByText("Paused: the squad used its share of your plan.")).toBeTruthy();
    expect(screen.getByText(/21 of 20 points of your weekly limit used\./)).toBeTruthy();
    const input = screen.getByLabelText("New share") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "15" } });
    await click("Resume with a bigger share");
    expect(screen.getByText(/must be above what's used \(21%\)/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "40" } });
    await click("Resume with a bigger share");
    expect(gateway.callsOf("resumeSquad")).toEqual([{ squadId: SQ, maxPercent: 40 }]);
  });

  it("pauses, and stops only after a confirmation", async () => {
    const { gateway } = await renderSquad("run");
    await click("Pause");
    expect(gateway.callsOf("pauseSquad")).toEqual([{ squadId: SQ }]);
    await click("Stop");
    expect(gateway.callsOf("stopSquad")).toEqual([]);
    await click("Stop squad");
    expect(gateway.callsOf("stopSquad")).toEqual([{ squadId: SQ }]);
  });
});

describe("Deliver", () => {
  for (const [mode, label, go] of [
    ["merge", "Merge into my branch", "Merge"],
    ["pr", "Open a pull request", "Open pull request"],
    ["branch", "Leave the branch", "Leave the branch"],
  ] as const) {
    it(`delivers by ${mode} after a confirmation`, async () => {
      const { gateway } = await renderSquad("deliver");
      await act(async () => {
        fireEvent.click(screen.getByRole("radio", { name: new RegExp(label) }));
        await flush();
      });
      expect(gateway.callsOf("deliverSquad")).toEqual([]);
      const confirm = screen.getAllByRole("button", { name: go }).at(-1) as HTMLElement;
      await act(async () => {
        fireEvent.click(confirm);
        await flush();
      });
      expect(gateway.callsOf("deliverSquad")).toEqual([{ squadId: SQ, mode }]);
    });
  }

  it("turns off the pull request when the GitHub CLI isn't there, and says why", async () => {
    const gateway = new FakeGateway();
    gateway.failures.deliverSquad = new GatewayError(RpcErrors.ghUnavailable.code, "no gh");
    await renderSquad("deliver", { gateway });
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: /Open a pull request/ }));
      await flush();
    });
    await click("Open pull request");
    const pr = screen.getByRole("radio", { name: /Open a pull request/ }) as HTMLInputElement;
    expect(pr.disabled).toBe(true);
    expect(pr.closest("label")?.textContent).toContain("Needs the GitHub CLI");
  });
});
