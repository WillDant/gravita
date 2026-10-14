import { AUTO_MODELS, type SquadState } from "@gravita/core";
import type { SquadPlan } from "@gravita/protocol";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { modelLabel } from "@/shared/presenters/squad";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { PROJECT, SQ, type SquadFixture, squadFixture } from "@/test/squadFixtures";
import SquadScreen from "./SquadScreen";

// Squads with Codex roles on screen: who runs each role on the Board (and switching it in a
// mixed squad, re-validated live), Codex's tiers in the estimate and on stuck tasks, and the
// provider mark on the run map and the role panel.

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

/** The backend on Codex, the others on Claude Code. */
const withCodexBackend = (plan: SquadPlan): SquadPlan => ({
  ...plan,
  roles: plan.roles.map((r) => (r.id === "backend" ? { ...r, provider: "codex" as const } : r)),
});

async function renderSquad(
  kind: SquadFixture,
  edit: (q: SquadState) => void,
  gateway = new FakeGateway(),
) {
  const data = squadFixture(kind);
  const q = data.state.squads?.[SQ];
  if (!q) throw new Error("fixture");
  q.models = { ...AUTO_MODELS };
  edit(q);
  gateway.conversationResult = { messages: data.conversation };
  const view = renderWithApp(<SquadScreen projectId={PROJECT} squadId={SQ} />, {
    state: data.state,
    gateway,
  });
  await act(async () => {
    await flush();
    await flush();
  });
  return view;
}

const mixed = (q: SquadState) => {
  q.providers = "mixed";
  if (q.plan) q.plan = withCodexBackend(q.plan);
};

const strip = (role: string) => screen.getByRole("region", { name: role });

describe("the Board of a squad with Codex roles", () => {
  it("lets a mixed squad's roles move between Claude Code and Codex, and approves the choice", async () => {
    const { gateway } = await renderSquad("review", mixed);
    const backend = within(strip("Backend"));
    expect((backend.getByRole("radio", { name: "Codex" }) as HTMLInputElement).checked).toBe(true);
    const frontend = within(strip("Frontend"));
    expect((frontend.getByRole("radio", { name: "Claude Code" }) as HTMLInputElement).checked).toBe(
      true,
    );
    // Codex's tiers show in the estimate by model.
    const byModel = screen.getByRole("list", { name: "The estimate by model" });
    expect(byModel.textContent).toContain("Codex · high effort");
    expect(byModel.textContent).toContain("Opus");

    await act(async () => {
      fireEvent.click(frontend.getByRole("radio", { name: "Codex" }));
      await flush();
    });
    expect((frontend.getByRole("radio", { name: "Codex" }) as HTMLInputElement).checked).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve and start" }));
      await flush();
    });
    const sent = gateway.callsOf("approvePlan")[0] as { plan: SquadPlan };
    expect(sent.plan.roles.map((r) => [r.id, r.provider])).toEqual([
      ["backend", "codex"],
      ["frontend", "codex"],
      ["tests", undefined],
    ]);
  });

  it("marks Codex roles in a Codex-only squad, without a switch, and holds a plan that breaks the choice", async () => {
    await renderSquad("review", (q) => {
      q.providers = "codex";
      if (q.plan)
        q.plan = {
          ...q.plan,
          roles: q.plan.roles.map((r) =>
            r.id === "tests" ? { ...r, provider: "claude" as const } : r,
          ),
        };
    });
    expect(within(strip("Backend")).getByRole("img", { name: "Codex session" })).toBeTruthy();
    expect(within(strip("Backend")).queryByRole("radio")).toBeNull();
    expect(
      screen.getByText('Role "tests" runs on Claude Code, but this squad is Codex only.'),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Approve and start" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("a Claude Code squad shows neither marks nor switches", async () => {
    await renderSquad("review", () => {});
    expect(screen.queryByRole("img", { name: "Codex session" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Codex" })).toBeNull();
  });
});

describe("running a squad with Codex roles", () => {
  it("marks the Codex role on the map and in its panel", async () => {
    await renderSquad("run", mixed);
    const map = screen.getByRole("group", { name: /The squad's map/ });
    expect(within(map).getByText("Cx")).toBeTruthy();
    const titles = [...map.querySelectorAll("title")].map((t) => t.textContent);
    expect(titles).toContain("Backend · Codex");
    expect(titles).toContain("Frontend");
    // The role's panel says who runs it.
    await act(async () => {
      fireEvent.click(within(map).getByRole("button", { name: "Backend · Codex" }));
      await flush();
    });
    const heading = screen.getByRole("heading", { level: 2, name: "Backend" });
    expect(
      within(heading.parentElement as HTMLElement).getByRole("img", { name: "Codex session" }),
    ).toBeTruthy();
  });

  it("offers a stuck Codex task a retry at high effort, in Codex's words", async () => {
    const { gateway } = await renderSquad("run", (q) => {
      q.providers = "codex";
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await flush();
    });
    const stronger = screen.getByRole("button", { name: "Retry with Codex · high effort" });
    await act(async () => {
      fireEvent.click(stronger);
      await flush();
    });
    expect(gateway.callsOf("retryTask")).toContainEqual({
      squadId: SQ,
      taskId: "tests-api",
      model: "default@high",
    });
  });
});

describe("Codex models in the user's words", () => {
  it("names Claude's families and Codex's efforts", () => {
    expect(modelLabel("opus")).toBe("Opus");
    expect(modelLabel("default@medium")).toBe("Codex · medium effort");
    expect(modelLabel("gpt-6-astra@xhigh")).toBe("gpt-6-astra · extra-high effort");
    expect(modelLabel("gpt-6-astra")).toBe("gpt-6-astra");
  });
});
