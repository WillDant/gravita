import type { GravitaState } from "@gravita/core";
import type { AccountPlan, EngineStatus } from "@gravita/protocol";
import { RpcErrors } from "@gravita/protocol/constants";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayError } from "@/infrastructure/engine/GatewayError";
import { setLocale } from "@/shared/i18n/i18n";
import { started, stateOf } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { NewSquadPanel } from "./NewSquadPanel";
import { parsePercent, parseUsd } from "./useNewSquad";

afterEach(cleanup);
setLocale("en");

const state = stateOf(started("s1", 5, "p1"));

const status = (plan?: AccountPlan): EngineStatus => {
  const claude = { found: true, ...(plan ? { account: { plan } } : {}) };
  return { providers: { claude }, claude, indexing: { done: 0, total: 0 }, demo: false };
};

function renderPanel(
  gateway = new FakeGateway(),
  defaultFolder = "/work/p1",
  o: { plan?: AccountPlan; state?: GravitaState } = {},
) {
  const onClose = vi.fn();
  const view = renderWithApp(
    <NewSquadPanel id="nq" defaultFolder={defaultFolder} onClose={onClose} />,
    { state: o.state ?? state, gateway },
  );
  act(() => view.store.getState().setEngineStatus(status(o.plan)));
  return { ...view, onClose };
}

/** A dollar budget: an account that pays per token (an API key). */
const apiKey = { plan: "api" as const };

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const start = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Start squad" }));
    await flush();
  });
};

describe("NewSquadPanel", () => {
  const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;

  it("prefills the project folder, a $25 budget, guarded autonomy and Automatic models", async () => {
    renderPanel(undefined, undefined, apiKey);
    await act(flush);
    expect(field("Folder").value).toBe("/work/p1");
    expect(field("Budget").value).toBe("25");
    expect(radio(/Guarded/).checked).toBe(true);
    expect(radio(/Automatic/).checked).toBe(true);
    expect(radio(/Automatic/).closest("label")?.textContent).toContain(
      "Sonnet for most work, Opus where it matters, Haiku for helpers; steps up only when a task struggles.",
    );
    expect(radio(/Opus everywhere/).checked).toBe(false);
    expect(radio(/Sonnet everywhere/).checked).toBe(false);
  });

  it("starts on the Automatic policy unless told otherwise", async () => {
    const gateway = new FakeGateway();
    renderPanel(gateway);
    fireEvent.change(field("What should the squad build?"), { target: { value: "A todo app" } });
    await start();
    expect(gateway.callsOf("createSquad")).toMatchObject([
      { models: { mode: "auto", briefing: "sonnet", planner: "opus", roles: "sonnet" } },
    ]);
  });

  it("asks for the goal and a budget in range before starting", async () => {
    const { gateway } = renderPanel(undefined, undefined, apiKey);
    await start();
    expect(screen.getByText("Say what the squad should build.")).toBeTruthy();
    fireEvent.change(field("What should the squad build?"), { target: { value: "A todo app" } });
    fireEvent.change(field("Budget"), { target: { value: "5000" } });
    await start();
    expect(screen.getByText("Enter a budget between $1 and $1,000.")).toBeTruthy();
    expect(gateway.callsOf("createSquad")).toEqual([]);
  });

  it("creates the squad with the chosen settings and opens it", async () => {
    const gateway = new FakeGateway();
    gateway.createSquadResult = { squadId: "sq-9", projectId: "p1" };
    const { navigate } = renderPanel(gateway, undefined, apiKey);
    fireEvent.change(field("What should the squad build?"), { target: { value: " A todo app " } });
    fireEvent.change(field("Budget"), { target: { value: "$40.50" } });
    fireEvent.click(screen.getByRole("radio", { name: /Autonomous/ }));
    fireEvent.click(radio(/Sonnet everywhere/));
    await start();
    expect(gateway.callsOf("createSquad")).toEqual([
      {
        cwd: "/work/p1",
        brief: "A todo app",
        budget: { mode: "usd", amount: 40.5 },
        autonomy: "auto",
        models: { mode: "fixed", planner: "sonnet", roles: "sonnet" },
      },
    ]);
    expect(navigate).toHaveBeenCalledWith({ level: "squad", projectId: "p1", squadId: "sq-9" });
  });

  it("explains a dirty repository in plain words", async () => {
    const gateway = new FakeGateway();
    gateway.failures.createSquad = new GatewayError(RpcErrors.dirtyWorktree.code, "dirty");
    renderPanel(gateway);
    fireEvent.change(field("What should the squad build?"), { target: { value: "A todo app" } });
    await start();
    expect(screen.getByRole("alert").textContent).toContain("uncommitted changes");
  });

  it("shows the connect steps when Claude Code isn't logged in", async () => {
    const gateway = new FakeGateway();
    gateway.failures.createSquad = new GatewayError(RpcErrors.notLoggedIn.code, "no");
    renderPanel(gateway);
    fireEvent.change(field("What should the squad build?"), { target: { value: "A todo app" } });
    await start();
    expect(screen.getByText("Log in to Claude Code")).toBeTruthy();
  });

  it("on a plan account the budget is a share of a plan window, with its usage and reset", async () => {
    const withUsage = structuredClone(state);
    withUsage.usage = {
      "claude:seven_day": {
        provider: "claude",
        window: "seven_day",
        usedPercent: 34,
        resetsAt: "2099-01-02T09:00:00.000Z",
        ts: "2026-10-12T10:00:00.000Z",
      },
    };
    const gateway = new FakeGateway();
    renderPanel(gateway, undefined, { plan: "limited", state: withUsage });
    await act(flush);
    // The panel asked the engine for fresh usage.
    expect(gateway.callsOf("refreshUsage")).toEqual([{ provider: "claude" }]);
    expect(screen.queryByLabelText("Budget")).toBeNull();
    expect(field("Share of your plan, in percent").value).toBe("20");
    const window = screen.getByLabelText("Plan window") as HTMLSelectElement;
    expect(window.value).toBe("seven_day");
    expect(screen.getByText(/Weekly: 34% used · resets/)).toBeTruthy();
    expect(screen.getByText(/Other use of the same account counts too/)).toBeTruthy();
    // The 5-hour window has no reading yet.
    fireEvent.change(window, { target: { value: "five_hour" } });
    expect(screen.getByText(/Usage shows here once a Claude Code session has run/)).toBeTruthy();
    fireEvent.change(field("What should the squad build?"), { target: { value: "A todo app" } });
    fireEvent.change(field("Share of your plan, in percent"), { target: { value: "120" } });
    await start();
    expect(screen.getByText("Enter a share between 1% and 100%.")).toBeTruthy();
    fireEvent.change(field("Share of your plan, in percent"), { target: { value: "15%" } });
    await start();
    expect(gateway.callsOf("createSquad")).toMatchObject([
      { budget: { mode: "plan", maxPercent: 15, window: "five_hour" } },
    ]);
  });

  it("switches to dollars when the engine finds the account has no plan limits", async () => {
    const gateway = new FakeGateway();
    gateway.failures.createSquad = new GatewayError(
      RpcErrors.planUsageUnavailable.code,
      "no plan limits",
      { provider: "claude" },
    );
    renderPanel(gateway);
    fireEvent.change(field("What should the squad build?"), { target: { value: "A todo app" } });
    await start();
    expect(screen.getByRole("alert").textContent).toContain("Give the squad a dollar budget");
    expect(field("Budget").value).toBe("25");
  });

  it("reads percents the way people type them", () => {
    expect(parsePercent("20%")).toBe(20);
    expect(parsePercent("12,5")).toBe(12.5);
    expect(Number.isNaN(parsePercent("lots"))).toBe(true);
  });

  it("reads dollars the way people type them", () => {
    expect(parseUsd("$1,000.50")).toBe(1000.5);
    expect(parseUsd("12")).toBe(12);
    expect(Number.isNaN(parseUsd("twelve"))).toBe(true);
  });
});
