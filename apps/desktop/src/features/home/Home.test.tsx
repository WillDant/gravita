import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { ago, ev, started, stateOf } from "@/test/events";
import { flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { PROJECT, SQ, squadFixture } from "@/test/squadFixtures";
import { Home } from "./Home";

afterEach(cleanup);
setLocale("en");

const p1 = { ts: ago(1), projectId: "p1", sessionId: "s1" };
const p2 = { ts: ago(1), projectId: "p2", sessionId: "s2" };

const state = stateOf(started("s1", 5, "p1", "chat"), started("s2", 5, "p2", "chat"), [
  ev("session.control", { controllable: true }, p1),
  ev(
    "permission.requested",
    { requestId: "r1", toolName: "Bash", inputPreview: "pnpm add jose" },
    { ...p1, agentId: "main" },
  ),
  ev("session.control", { controllable: true }, p2),
  ev(
    "question.asked",
    {
      requestId: "q1",
      questions: [{ question: "Which database?", multiSelect: false, options: [] }],
    },
    { ...p2, agentId: "main" },
  ),
]);

describe("Home: needs you", () => {
  it("lists permission asks and questions, each with its own way to answer", async () => {
    const { navigate } = renderWithApp(<Home />, { state });
    await act(flush);
    const section = within(screen.getByRole("region", { name: "Needs you" }));

    expect(section.getByText("Bash · pnpm add jose")).toBeTruthy();
    expect(section.getByRole("button", { name: "Allow" })).toBeTruthy();

    expect(section.getByText("Which database?")).toBeTruthy();
    fireEvent.click(section.getByRole("button", { name: "Answer" }));
    expect(navigate).toHaveBeenCalledWith({
      level: "session",
      projectId: "p2",
      sessionId: "s2",
      agentId: "main",
    });
  });

  it("opens the new-session panel inline under the header", () => {
    renderWithApp(<Home />, { state });
    const toggle = screen.getByRole("button", { name: "New session" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "New session" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "p1" })).toBeTruthy();
  });

  it("guides to Claude Code when it isn't installed, never in demo", () => {
    const { store } = renderWithApp(<Home />, { state });
    act(() =>
      store.getState().setEngineStatus({
        providers: { claude: { found: false } },
        claude: { found: false },
        indexing: { done: 0, total: 0 },
        demo: false,
      }),
    );
    expect(screen.getByRole("heading", { name: "Connect Claude Code" })).toBeTruthy();
    act(() =>
      store.getState().setEngineStatus({
        providers: { claude: { found: false } },
        claude: { found: false },
        indexing: { done: 0, total: 0 },
        demo: true,
      }),
    );
    expect(screen.queryByRole("heading", { name: "Connect Claude Code" })).toBeNull();
  });

  it("lists what a squad waits on you for, and opens the task", async () => {
    const { navigate } = renderWithApp(<Home />, { state: squadFixture("run").state });
    await act(flush);
    const section = screen.getByRole("region", { name: "Needs you" });
    expect(within(section).getByText("API tests is waiting for you")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Decide" }));
    expect(navigate).toHaveBeenCalledWith({
      level: "squad",
      projectId: PROJECT,
      squadId: SQ,
      taskId: "tests-api",
    });
  });
});
