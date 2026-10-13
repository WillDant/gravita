import type { GravitaEvent } from "@gravita/protocol";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/shared/i18n/i18n";
import { ev, NOW, started, stateOf } from "@/test/events";
import { LineMap } from "./LineMap";

afterEach(cleanup);
setLocale("en");

beforeAll(() => {
  // jsdom has no layout: the map measures nothing and keeps its default spacing.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

/** Main launches `n` subagents in one message and every one of them asks to run Bash. */
function swarm(n: number): GravitaEvent[] {
  const at = { sessionId: "s1" };
  const events: GravitaEvent[] = [ev("session.presence", { pid: 1, status: "busy" }, at)];
  for (let i = 0; i < n; i++) {
    const agentId = `a${i}`;
    events.push(
      ev(
        "tool.started",
        {
          toolUseId: `t${i}`,
          name: "Agent",
          kind: "agent",
          target: { agentType: "Explore" },
          inputPreview: "Explore",
        },
        { ...at, agentId: "main" },
      ),
      ev(
        "agent.spawned",
        {
          parentAgentId: "main",
          spawnToolUseId: `t${i}`,
          agentType: "Explore",
          depth: 1,
          background: false,
        },
        { ...at, agentId },
      ),
      ev(
        "permission.requested",
        { requestId: `r${i}`, toolName: "Bash", inputPreview: "pnpm test" },
        { ...at, agentId },
      ),
    );
  }
  return events;
}

describe("LineMap: the 1/3 motion budget", () => {
  it("lets only a third of the orbs bounce; every waiting orb keeps its halo", () => {
    const events = [...started("s1", 1), ...swarm(6)];
    const session = stateOf(events).sessions.s1!;
    const { container } = render(
      <LineMap session={session} events={events} now={NOW} onSelectAgent={() => {}} />,
    );

    // Seven heads (main and six waiting subagents): a budget of two.
    expect(container.querySelectorAll('[role="button"] > svg')).toHaveLength(7);
    expect(container.querySelectorAll(".orb-bounce")).toHaveLength(2);
    expect(container.querySelectorAll(".ring-pulse")).toHaveLength(6);
  });

  it("links the six parallel spawns on main into one interchange connector", () => {
    const events = [...started("s1", 1), ...swarm(6)];
    const session = stateOf(events).sessions.s1!;
    const { container } = render(
      <LineMap session={session} events={events} now={NOW} onSelectAgent={() => {}} />,
    );
    const capsules = container.querySelectorAll('rect[height="25"]');
    const links = container.querySelectorAll('rect[height="10"]');
    expect(capsules).toHaveLength(6);
    expect(links).toHaveLength(1);
  });
});
