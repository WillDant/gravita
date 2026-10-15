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

  it("opens the new-session panel at once when the sidebar's + asked for it", () => {
    const { store } = renderWithApp(<Home />, { state });
    expect(screen.queryByRole("region", { name: "New session" })).toBeNull();
    act(() => store.getState().setRoute({ level: "home", newSession: true }));
    expect(screen.getByRole("region", { name: "New session" })).toBeTruthy();
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

describe("Home: Codex", () => {
  const engine = (codex: { found: boolean; outdated?: boolean }) => ({
    providers: { claude: { found: true }, codex },
    claude: { found: true },
    indexing: { done: 0, total: 0 },
    demo: false,
  });

  it("never nags a Claude Code user who has sessions about a missing Codex", () => {
    const { store } = renderWithApp(<Home />, { state });
    act(() => store.getState().setEngineStatus(engine({ found: false })));
    expect(screen.queryByText(/Using Codex\?/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Connect Codex" })).toBeNull();
    expect(screen.queryByRole("button", { name: "How to install" })).toBeNull();
  });

  it("mentions Codex on an empty Home, with its install steps on demand", () => {
    const { store } = renderWithApp(<Home />);
    act(() => store.getState().setEngineStatus(engine({ found: false })));
    expect(screen.getByText(/Start Claude Code or Codex in any project/)).toBeTruthy();
    expect(screen.getByText(/Using Codex\?/)).toBeTruthy();
    const show = screen.getByRole("button", { name: "How to install" });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("heading", { name: "Connect Codex" })).toBeNull();
    fireEvent.click(show);
    expect(show.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading", { name: "Connect Codex" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy brew install --cask codex" })).toBeTruthy();
  });

  it("says once, quietly, that an installed Codex is too old", () => {
    const { store } = renderWithApp(<Home />, { state });
    act(() => store.getState().setEngineStatus(engine({ found: true, outdated: true })));
    expect(screen.getByText(/This Codex is older than Gravita supports/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "How to update" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Update Codex" })).toBeNull();
  });
});

describe("Home: plan usage", () => {
  const reading = (
    window: "five_hour" | "seven_day",
    usedPercent: number,
    status?: "warning" | "rejected",
  ) =>
    ev(
      "usage.limits",
      {
        provider: "claude",
        window,
        usedPercent,
        resetsAt: "2099-01-02T09:00:00.000Z",
        ...(status ? { status } : {}),
      },
      { ts: ago(1), projectId: "" },
    );

  it("shows each window's use and reset in one quiet line", async () => {
    renderWithApp(<Home />, {
      state: stateOf([reading("five_hour", 34), reading("seven_day", 61)]),
    });
    await act(flush);
    const line = screen.getByRole("group", { name: "Plan usage" });
    expect(line.textContent).toContain("Claude plan");
    expect(line.textContent).toContain("5-hour: 34% used · resets");
    expect(line.textContent).toContain("Weekly: 61% used · resets");
    // Nothing waits on the user: no orange.
    expect(line.querySelector(".text-waiting-ink")).toBeNull();
  });

  it("turns a window orange, with words, only when the plan is close to its limit", async () => {
    renderWithApp(<Home />, {
      state: stateOf([reading("five_hour", 92, "warning"), reading("seven_day", 40)]),
    });
    await act(flush);
    const near = screen.getByText(/5-hour: 92% used · resets .* · close to the limit/);
    expect(near.className).toContain("text-waiting-ink");
  });

  it("shows the user's own Codex account, never Gravita's Codex profile for squads", async () => {
    const codex = (usedPercent: number, account?: "squadProfile") =>
      ev(
        "usage.limits",
        {
          provider: "codex",
          ...(account ? { account } : {}),
          window: "five_hour",
          usedPercent,
          resetsAt: "2099-01-02T09:00:00.000Z",
        },
        { ts: ago(1), projectId: "" },
      );
    renderWithApp(<Home />, { state: stateOf([codex(23), codex(77, "squadProfile")]) });
    await act(flush);
    const line = screen.getByRole("group", { name: "Plan usage" });
    expect(line.textContent).toContain("5-hour: 23% used");
    expect(line.textContent).not.toContain("77%");
  });

  it("shows nothing before any reading", async () => {
    renderWithApp(<Home />, { state });
    await act(flush);
    expect(screen.queryByRole("group", { name: "Plan usage" })).toBeNull();
  });
});
