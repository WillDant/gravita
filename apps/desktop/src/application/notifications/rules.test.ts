import { applyAll, type GravitaState } from "@gravita/core";
import type { GravitaEvent } from "@gravita/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFS } from "@/infrastructure/preferences/notificationPrefs";
import { setLocale } from "@/shared/i18n/i18n";
import { ago, ev, NOW, started, stateOf } from "@/test/events";
import { notificationsFor, stillRelevant } from "./rules";

beforeEach(() => setLocale("en"));

const at = (agentId?: string, minutesAgo = 0, sessionId = "s") => ({
  ts: ago(minutesAgo),
  projectId: "payments-api",
  sessionId,
  ...(agentId ? { agentId } : {}),
});

/** A live chat Gravita runs, titled, with a general-purpose subagent "a". */
function base(controllable = true): GravitaState {
  return stateOf(started("s", 5, "payments-api", "chat"), [
    ev("session.presence", { status: "busy" }, at(undefined, 4)),
    ev("session.control", { controllable }, at(undefined, 4)),
    ev("session.titled", { title: "Audit before release" }, at(undefined, 4)),
    ev(
      "agent.spawned",
      { parentAgentId: "main", agentType: "general-purpose", depth: 1, background: false },
      at("a", 3),
    ),
  ]);
}

/** Applies a live batch and asks the rules about it, like the service does. */
function live(events: GravitaEvent[], state = base(), prefs = DEFAULT_NOTIFICATION_PREFS) {
  const next = applyAll(structuredClone(state), events);
  return { state: next, intents: notificationsFor(events, next, NOW, prefs) };
}

const permission = (agentId = "a", minutesAgo = 0) =>
  ev(
    "permission.requested",
    { requestId: `r-${agentId}`, toolName: "Bash", inputPreview: "pnpm add stripe@latest" },
    at(agentId, minutesAgo),
  );

describe("notification rules", () => {
  it("tells you an agent waits for your approval, in the Needs-you row's words", () => {
    const { intents } = live([permission()]);
    expect(intents).toEqual([
      {
        kind: "waiting",
        sessionId: "s",
        agentId: "a",
        title: "general-purpose is waiting for your approval",
        body: "payments-api › Audit before release · Bash · pnpm add stripe@latest",
        route: { level: "session", projectId: "payments-api", sessionId: "s", agentId: "a" },
      },
    ]);
  });

  it("speaks pt-BR when the app does", () => {
    setLocale("pt-BR");
    const { intents } = live([permission("main")]);
    expect(intents[0]?.title).toBe("Agente principal espera sua aprovação");
  });

  it("tells you about a question with the question itself", () => {
    const { intents } = live([
      ev(
        "question.asked",
        {
          requestId: "q1",
          questions: [{ question: "Which database?", multiSelect: false, options: [] }],
        },
        at("a"),
      ),
    ]);
    expect(intents[0]).toMatchObject({
      kind: "waiting",
      title: "general-purpose has a question for you",
      body: "payments-api › Audit before release · Which database?",
    });
  });

  it("stays quiet when the request was answered in the same batch", () => {
    const { intents } = live([
      permission(),
      ev("permission.resolved", { requestId: "r-a", decision: "allow", by: "policy" }, at("a")),
    ]);
    expect(intents).toEqual([]);
  });

  it("ignores history: events older than a minute never notify", () => {
    expect(live([permission("a", 2)]).intents).toEqual([]);
  });

  it("tells you when a chat Gravita runs finishes its turn", () => {
    const { intents } = live([ev("turn.completed", { subtype: "success" }, at())]);
    expect(intents).toEqual([
      expect.objectContaining({
        kind: "finished",
        agentId: "main",
        title: "Main agent finished",
        body: "payments-api › Audit before release",
      }),
    ]);
  });

  it("doesn't announce turns of sessions Gravita doesn't run, or that just ended", () => {
    expect(live([ev("turn.completed", {}, at())], base(false)).intents).toEqual([]);
    expect(
      live([ev("turn.completed", {}, at()), ev("session.ended", { reason: "stopped" }, at())])
        .intents,
    ).toEqual([]);
  });

  it("reports failures calmly: a failed agent, a failed turn, a fatal error", () => {
    const failed = live([
      ev("agent.completed", { status: "failed", summary: "Tests broke" }, at("a")),
    ]);
    expect(failed.intents[0]).toMatchObject({
      kind: "failed",
      title: "general-purpose stopped with an error",
      body: "payments-api › Audit before release · Tests broke",
    });
    expect(
      live([ev("turn.completed", { subtype: "error_during_execution" }, at())]).intents[0],
    ).toMatchObject({ kind: "failed", title: "Main agent stopped with an error" });
    expect(
      live([ev("error", { kind: "api", message: "Overloaded", retryable: false }, at())])
        .intents[0],
    ).toMatchObject({ kind: "failed", body: "payments-api › Audit before release · Overloaded" });
  });

  it("leaves retryable errors and stopped agents alone", () => {
    expect(
      live([ev("error", { kind: "api", message: "Overloaded", retryable: true }, at())]).intents,
    ).toEqual([]);
    expect(live([ev("agent.completed", { status: "stopped" }, at("a"))]).intents).toEqual([]);
  });

  it("respects the preferences", () => {
    const off = { waiting: false, finished: false, failures: false };
    expect(live([permission()], base(), off).intents).toEqual([]);
    expect(live([ev("turn.completed", {}, at())], base(), off).intents).toEqual([]);
    expect(
      live([ev("agent.completed", { status: "failed" }, at("a"))], base(), off).intents,
    ).toEqual([]);
  });

  it("makes one intent per agent and kind", () => {
    const { intents } = live([
      permission(),
      ev(
        "permission.requested",
        { requestId: "r2", toolName: "Edit", inputPreview: "a.ts" },
        at("a"),
      ),
      permission("main"),
    ]);
    expect(intents.map((n) => `${n.agentId}:${n.kind}`)).toEqual(["a:waiting", "main:waiting"]);
  });

  it("knows when a notification stopped mattering", () => {
    const { state, intents } = live([permission()]);
    const waiting = intents[0]!;
    expect(stillRelevant(waiting, state, NOW)).toBe(true);
    const answered = applyAll(structuredClone(state), [
      ev("permission.resolved", { requestId: "r-a", decision: "allow", by: "user" }, at("a")),
    ]);
    expect(stillRelevant(waiting, answered, NOW)).toBe(false);
    expect(stillRelevant({ ...waiting, kind: "finished" }, answered, NOW)).toBe(true);
    expect(stillRelevant({ ...waiting, sessionId: "gone" }, answered, NOW)).toBe(false);
  });
});
