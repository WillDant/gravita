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

describe("NewSquadPanel with Codex", () => {
  const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
  const withCodex = (profile?: { loggedIn: boolean; planType?: string; signingIn?: boolean }) => {
    const claude = { found: true, account: { plan: "limited" as const } };
    return {
      providers: {
        claude,
        codex: { found: true, ...(profile ? { squadProfile: profile } : {}) },
      },
      claude,
      indexing: { done: 0, total: 0 },
      demo: false,
    } satisfies EngineStatus;
  };

  function renderCodexPanel(profile?: { loggedIn: boolean; planType?: string }) {
    const gateway = new FakeGateway();
    const view = renderWithApp(
      <NewSquadPanel id="nq" defaultFolder="/work/p1" onClose={() => {}} />,
      {
        state,
        gateway,
      },
    );
    act(() => view.store.getState().setEngineStatus(withCodex(profile)));
    return view;
  }

  it("offers who builds it only when Codex is installed", async () => {
    renderPanel();
    await act(flush);
    expect(screen.queryByRole("radio", { name: /Codex only/ })).toBeNull();
    cleanup();
    renderCodexPanel({ loggedIn: true });
    await act(flush);
    expect(radio(/Claude Code only/).checked).toBe(true);
    expect(radio(/Codex only/)).toBeTruthy();
    expect(radio(/Mixed/).closest("label")?.textContent).toContain(
      "you can change it on the Board",
    );
  });

  it("explains Gravita's Codex profile and signs in to it through Codex's own page", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { gateway, store } = renderCodexPanel({ loggedIn: false });
    await act(flush);
    fireEvent.click(radio(/Mixed/));
    await act(flush);
    // The panel read the profile when a choice with Codex in it was made.
    expect(gateway.callsOf("codexProfileStatus")).toHaveLength(1);
    expect(screen.getByText(/don't inherit your MCP servers or hooks/)).toBeTruthy();
    // Starting without it: the sign-in is what's missing, and nothing is created.
    fireEvent.change(field("What should the squad build?"), { target: { value: "A todo app" } });
    await start();
    expect(gateway.callsOf("createSquad")).toEqual([]);
    const signIn = screen.getByRole("button", { name: "Sign in to Codex for squads" });
    expect(document.activeElement).toBe(signIn);
    await act(async () => {
      fireEvent.click(signIn);
      await flush();
    });
    expect(gateway.callsOf("codexProfileSignIn")).toHaveLength(1);
    expect(open).toHaveBeenCalledWith(
      "https://auth.openai.com/oauth/authorize?client_id=codex",
      "_blank",
      "noopener,noreferrer",
    );
    // Codex finished the browser step: the engine's status says so.
    act(() => store.getState().setEngineStatus(withCodex({ loggedIn: true, planType: "team" })));
    expect(screen.getByText("Codex for squads is signed in (team plan).")).toBeTruthy();
    await start();
    expect(gateway.callsOf("createSquad")).toMatchObject([
      { providers: "mixed", budget: { mode: "plan" } },
    ]);
    open.mockRestore();
  });

  it("never opens a link that isn't OpenAI's sign-in page", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { gateway } = renderCodexPanel({ loggedIn: false });
    gateway.signInResult = { authUrl: "https://evil.example/login" };
    await act(flush);
    fireEvent.click(radio(/Codex only/));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in to Codex for squads" }));
      await flush();
    });
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("couldn't open your browser");
    open.mockRestore();
  });

  it("a Codex squad's share shows the usage of Gravita's Codex profile, not the user's own", async () => {
    const withUsage = structuredClone(state);
    const reading = { window: "seven_day" as const, ts: "2026-10-12T10:00:00.000Z" };
    withUsage.usage = {
      // The user's own Codex, maybe another ChatGPT account: not what the squad counts.
      "codex:seven_day": { ...reading, provider: "codex", usedPercent: 81 },
      "codex:squadProfile:seven_day": {
        ...reading,
        provider: "codex",
        account: "squadProfile",
        usedPercent: 12,
      },
    };
    const gateway = new FakeGateway();
    const view = renderWithApp(
      <NewSquadPanel id="nq" defaultFolder="/work/p1" onClose={() => {}} />,
      { state: withUsage, gateway },
    );
    act(() => view.store.getState().setEngineStatus(withCodex({ loggedIn: true })));
    await act(flush);
    fireEvent.click(radio(/Codex only/));
    expect(screen.getByText(/Weekly: 12% used/)).toBeTruthy();
    expect(screen.queryByText(/81% used/)).toBeNull();
  });

  it("a Codex squad's budget is a share of the plan even on an API-key Claude account", async () => {
    const gateway = new FakeGateway();
    const view = renderWithApp(
      <NewSquadPanel id="nq" defaultFolder="/work/p1" onClose={() => {}} />,
      {
        state,
        gateway,
      },
    );
    const s = withCodex({ loggedIn: true });
    act(() =>
      view.store.getState().setEngineStatus({
        ...s,
        providers: { ...s.providers, claude: { found: true, account: { plan: "api" } } },
      }),
    );
    await act(flush);
    expect(field("Budget")).toBeTruthy();
    fireEvent.click(radio(/Codex only/));
    expect(screen.queryByLabelText("Budget")).toBeNull();
    expect(screen.getByText(/Codex roles are measured in plan usage/)).toBeTruthy();
    // Its models are Codex's efforts, said that way.
    expect(radio(/High effort everywhere/)).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Opus everywhere/ })).toBeNull();
    fireEvent.change(field("What should the squad build?"), { target: { value: "A todo app" } });
    await start();
    expect(gateway.callsOf("createSquad")).toMatchObject([
      { providers: "codex", budget: { mode: "plan", maxPercent: 20 } },
    ]);
  });
});
