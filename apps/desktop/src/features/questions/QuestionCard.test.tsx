import type { GravitaState } from "@gravita/core";
import type { Question } from "@gravita/protocol";
import { RpcErrors } from "@gravita/protocol/constants";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayError } from "@/infrastructure/engine/GatewayError";
import { setLocale } from "@/shared/i18n/i18n";
import { ago, ev, started, stateOf } from "@/test/events";
import { flush } from "@/test/FakeGateway";
import { renderWithApp } from "@/test/render";
import { QuestionCard } from "./QuestionCard";
import { buildAnswer, firstQuestion } from "./questions";

afterEach(cleanup);
setLocale("en");

const at = { ts: ago(1), projectId: "p1", sessionId: "s", agentId: "main" };

const SINGLE: Question = {
  question: "Which database?",
  header: "Storage",
  multiSelect: false,
  options: [{ label: "Postgres", description: "Relational" }, { label: "SQLite" }],
};
const MULTI: Question = {
  question: "Which checks?",
  multiSelect: true,
  options: [{ label: "Lint" }, { label: "Types" }, { label: "Tests" }],
};

function asking(questions: Question[], controllable = true): GravitaState {
  return stateOf(started("s", 5, "p1", "chat"), [
    ev("session.control", { controllable }, at),
    ev("question.asked", { requestId: "q1", questions }, at),
  ]);
}

function renderCard(state: GravitaState) {
  const session = state.sessions.s!;
  const agent = session.agents.main!;
  return renderWithApp(
    <QuestionCard session={session} agent={agent} pending={firstQuestion(agent)!} />,
    { state },
  );
}

const send = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await flush();
  });
};

describe("buildAnswer", () => {
  it("maps question text to labels, joining several, with an optional reply", () => {
    expect(buildAnswer([SINGLE, MULTI], { 0: ["SQLite"], 1: ["Lint", "Tests"] }, "  ")).toEqual({
      answers: { "Which database?": "SQLite", "Which checks?": "Lint, Tests" },
    });
    expect(buildAnswer([SINGLE], {}, " use both ")).toEqual({
      answers: {},
      response: "use both",
    });
  });
});

describe("QuestionCard", () => {
  it("answers a single-choice question with the picked label", async () => {
    const { gateway } = renderCard(asking([SINGLE]));
    expect(screen.getByText("Storage")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /Postgres/ }));
    fireEvent.click(screen.getByRole("radio", { name: /SQLite/ }));
    await send();

    expect(gateway.callsOf("answerQuestion")).toEqual([
      {
        sessionId: "s",
        agentId: "main",
        requestId: "q1",
        answers: { "Which database?": "SQLite" },
      },
    ]);
  });

  it("joins multi-choice labels and adds the free-text reply", async () => {
    const { gateway } = renderCard(asking([MULTI]));
    fireEvent.click(screen.getByRole("checkbox", { name: "Lint" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Types" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Tests" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Types" }));
    fireEvent.change(screen.getByLabelText("Or answer in your own words"), {
      target: { value: "Run tests last" },
    });
    await send();

    expect(gateway.callsOf("answerQuestion")).toEqual([
      {
        sessionId: "s",
        agentId: "main",
        requestId: "q1",
        answers: { "Which checks?": "Lint, Tests" },
        response: "Run tests last",
      },
    ]);
  });

  it("asks for an answer before sending, and shows the engine's refusal", async () => {
    const { gateway } = renderCard(asking([SINGLE]));
    await send();
    expect(screen.getByRole("alert").textContent).toBe("Pick an option or write an answer.");
    expect(gateway.callsOf("answerQuestion")).toEqual([]);

    gateway.failures.answerQuestion = new GatewayError(
      RpcErrors.notControllable.code,
      RpcErrors.notControllable.message,
    );
    fireEvent.click(screen.getByRole("radio", { name: /SQLite/ }));
    await send();
    expect(screen.getByRole("alert").textContent).toContain("runs in your terminal");
  });

  it("points to the terminal when Gravita doesn't run the session", () => {
    renderCard(asking([SINGLE], false));
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText(/terminal/i)).toBeTruthy();
  });
});
