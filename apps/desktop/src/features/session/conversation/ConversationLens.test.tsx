import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { ago, ev, started, stateOf } from "@/test/events";
import { FakeGateway, flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import ConversationLens from "./ConversationLens";

afterEach(cleanup);
setLocale("en");

const at = (minutesAgo: number) => ({ ts: ago(minutesAgo), projectId: "p1", sessionId: "s" });
const control = ev("session.control", { controllable: true }, at(5));
const said = (uuid: string, minutesAgo: number, text: string, role: "user" | "assistant") => ({
  uuid,
  role,
  ts: ago(minutesAgo),
  text,
});

async function renderLens(extra: ReturnType<typeof ev>[] = [], provider?: string) {
  const events = [...started("s", 5, "p1", "chat"), control, ...extra];
  const state = stateOf(events);
  const session = provider ? { ...state.sessions.s!, provider } : state.sessions.s!;
  const gateway = new FakeGateway();
  gateway.sessionEventsResult = { events };
  const view = renderWithApp(<ConversationLens session={session} onSelect={() => {}} />, {
    state,
    gateway,
  });
  act(() => view.store.getState().loadSession("s"));
  await act(flush);
  return view;
}

describe("ConversationLens", () => {
  it("greets a fresh chat instead of announcing that the agent thinks", async () => {
    await renderLens([], "codex");
    expect(screen.getByText("Hello! Codex is ready.")).toBeTruthy();
    expect(screen.getByText("Start working whenever you like.")).toBeTruthy();
    expect(screen.queryByText("Main agent is thinking")).toBeNull();
  });

  it("greets by the generic name when the provider has no mark", async () => {
    await renderLens();
    expect(screen.getByText("Hello! Main agent is ready.")).toBeTruthy();
  });

  it("shows a sent message right away, then the transcript's copy only", async () => {
    const view = await renderLens();
    view.gateway.conversationResult = { messages: [] };
    view.gateway.held.add("sendMessage");

    act(() => void view.store.getState().sendMessage("s", "Ship it"));
    expect(screen.getByText("Ship it")).toBeTruthy();
    expect(screen.getByText("Main agent is thinking")).toBeTruthy();

    view.gateway.release();
    view.gateway.conversationResult = { messages: [said("u1", 0, "Ship it", "user")] };
    act(() => view.store.getState().refreshConversation());
    await act(flush);

    expect(screen.getAllByText("Ship it")).toHaveLength(1);
    expect(view.store.getState().pendingMessage).toBeUndefined();
  });

  it("says what the main agent is doing while it works", async () => {
    await renderLens([
      ev(
        "tool.started",
        {
          toolUseId: "t1",
          name: "Edit",
          kind: "edit",
          target: { path: "/work/p1/auth.ts" },
          inputPreview: "",
        },
        at(0),
      ),
    ]);
    expect(screen.getByRole("status").textContent).toBe("Main agent is editing auth.ts");
  });

  it("folds the tool calls between messages into one line that opens", async () => {
    const view = await renderLens([
      ev(
        "tool.started",
        {
          toolUseId: "t1",
          name: "Bash",
          kind: "bash",
          target: { cmd: "pnpm test" },
          inputPreview: "",
        },
        at(3),
      ),
      ev("tool.completed", { toolUseId: "t1", ok: true }, at(3)),
    ]);
    view.gateway.conversationResult = {
      messages: [said("u1", 4, "Run the tests", "user"), said("a1", 2, "All green.", "assistant")],
    };
    act(() => view.store.getState().refreshConversation());
    await act(flush);

    const line = screen.getByRole("button", { name: /Ran pnpm test/ });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
  });
});
