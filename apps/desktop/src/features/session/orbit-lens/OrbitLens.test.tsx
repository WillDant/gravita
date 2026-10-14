import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { ago, ev, started, stateOf } from "@/test/events";
import { flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { Session } from "../Session";
import OrbitLens from "./OrbitLens";

afterEach(cleanup);
setLocale("en");
// jsdom has no canvas (say so quietly instead of logging "not implemented") and no
// ResizeObserver, which the line map behind the default tab needs.
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

const at = { ts: ago(1), projectId: "p1", sessionId: "s1" };
const spawn = (agentId: string, parentAgentId = "main", agentType = "Explore") =>
  ev(
    "agent.spawned",
    { parentAgentId, agentType, depth: parentAgentId === "main" ? 1 : 2, background: false },
    { ...at, agentId },
  );

const state = stateOf(started("s1", 5, "p1", "chat"), [
  ev("session.control", { controllable: true }, at),
  ev(
    "permission.requested",
    { requestId: "r1", toolName: "Bash", inputPreview: "pnpm add jose" },
    { ...at, agentId: "main" },
  ),
  spawn("a1"),
  ev(
    "tool.started",
    {
      toolUseId: "t1",
      name: "Read",
      kind: "read",
      target: { path: "/work/p1/src/status.ts" },
      inputPreview: "status.ts",
    },
    { ...at, agentId: "a1" },
  ),
  spawn("a2", "main", "Plan"),
]);

function renderLens(s = state) {
  const session = s.sessions.s1!;
  const project = s.projects.p1!;
  const selected: string[] = [];
  const view = renderWithApp(
    <OrbitLens
      session={session}
      project={project}
      now={Date.parse(ago(0))}
      onSelect={(id) => selected.push(id)}
    />,
    { state: s },
  );
  return { ...view, selected };
}

describe("OrbitLens", () => {
  it("names every orb with its agent and what it's doing, planet first", () => {
    renderLens();
    const group = within(screen.getByRole("group", { name: "Agents orbiting p1" }));
    const names = group.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Main agent is waiting for your approval",
      "Explore is reading status.ts",
      "Plan is thinking",
    ]);
  });

  it("opens the agent when its orb is pressed; orbs are native, focusable buttons", () => {
    const { selected } = renderLens();
    fireEvent.click(screen.getByRole("button", { name: "Explore is reading status.ts" }));
    const plan = screen.getByRole("button", { name: "Plan is thinking" });
    plan.focus();
    expect(document.activeElement).toBe(plan);
    expect(plan.tagName).toBe("BUTTON"); // Enter and Space press it natively
    fireEvent.click(plan);
    expect(selected).toEqual(["a1", "a2"]);
  });

  it("gathers a crowd of moons into one swarm button that opens their parent", () => {
    const crowd = stateOf(started("s1", 5, "p1", "chat"), [
      ...Array.from({ length: 9 }, (_, i) => spawn(`k${i}`)),
    ]);
    const { selected } = renderLens(crowd);
    fireEvent.click(screen.getByRole("button", { name: "4 more subagents of Main agent" }));
    expect(selected).toEqual(["main"]);
    expect(screen.getAllByRole("button")).toHaveLength(1 + 5 + 1);
  });
});

describe("Session: Orbit tab", () => {
  it("sits second among the map's lenses and opens the agent panel route", async () => {
    const { navigate } = renderWithApp(<Session projectId="p1" sessionId="s1" />, { state });
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    // The conversation isn't a lens any more: it is the talk pane beside the map.
    expect(tabs).toEqual(["Lines", "Orbit", "Tree"]);
    expect(screen.getByRole("tab", { name: "Lines" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Orbit" }));
    const orb = await screen.findByRole("button", { name: "Explore is reading status.ts" });
    fireEvent.click(orb);
    expect(navigate).toHaveBeenCalledWith({
      level: "session",
      projectId: "p1",
      sessionId: "s1",
      agentId: "a1",
    });
    await act(flush);
  });
});
