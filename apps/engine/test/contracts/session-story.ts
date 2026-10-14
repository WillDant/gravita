import { expect } from "bun:test";
import { applyAll, emptyState, type Lifecycle, type SessionState } from "@gravita/core";
import type { GravitaEvent, ToolKind } from "@gravita/protocol";

// One story, told by every provider's fixture: the user asks to map the auth flow and plan
// a migration; the main agent sends an explorer, then a planner that sends its own explorer
// (which edits a file), reads a config itself and answers. Each provider's events, through
// the same projection, must show the same agent tree, final statuses, tool counts by kind
// and token totals. A provider names its agents its own way; `StoryAgents` maps the roles.

export type StoryRole = "main" | "explorer" | "planner" | "nested";

/** The agent id each role has in one provider's session. */
export type StoryAgents = Record<StoryRole, string>;

const PARENT: Record<StoryRole, StoryRole | null> = {
  main: null,
  explorer: "main",
  planner: "main",
  nested: "planner",
};

const LIFECYCLE: Record<StoryRole, Lifecycle> = {
  main: "idle",
  explorer: "done",
  planner: "done",
  nested: "done",
};

const TOOLS: Record<StoryRole, Partial<Record<ToolKind, number>>> = {
  main: { agent: 2, read: 1 },
  explorer: { search: 1 },
  planner: { agent: 1 },
  nested: { edit: 1 },
};

/** Uncached input, output, cache reads and writes, per role. */
const TOKENS: Record<
  StoryRole,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  main: { input: 20, output: 92, cacheRead: 490, cacheWrite: 20 },
  explorer: { input: 6, output: 17, cacheRead: 50, cacheWrite: 50 },
  planner: { input: 8, output: 31, cacheRead: 60, cacheWrite: 60 },
  nested: { input: 2, output: 6, cacheRead: 0, cacheWrite: 40 },
};

function toolKinds(events: readonly GravitaEvent[], agentId: string) {
  const out: Partial<Record<ToolKind, number>> = {};
  for (const e of events) {
    if (e.type !== "tool.started" || (e.agentId ?? "main") !== agentId) continue;
    out[e.data.kind] = (out[e.data.kind] ?? 0) + 1;
  }
  return out;
}

/** Projects `events` and checks the story; returns the session for provider-specific checks. */
export function expectNestedBackgroundStory(
  events: readonly GravitaEvent[],
  agents: StoryAgents,
): SessionState {
  const state = applyAll(emptyState(), events);
  const sessions = Object.values(state.sessions);
  expect(sessions).toHaveLength(1);
  const s = sessions[0]!;
  expect(s.cwd).toBe("/work/demo");
  expect(s.firstUserText).toBe("Map the auth flow and plan the migration");
  expect(Object.keys(s.agents).sort()).toEqual(Object.values(agents).sort());

  for (const role of Object.keys(agents) as StoryRole[]) {
    const a = s.agents[agents[role]]!;
    const parentRole = PARENT[role];
    const parent = parentRole ? agents[parentRole] : null;
    expect({ role, parent: a.parentId }).toEqual({ role, parent });
    expect({ role, lifecycle: a.lifecycle }).toEqual({ role, lifecycle: LIFECYCLE[role] });
    expect({ role, tools: toolKinds(events, agents[role]) }).toEqual({ role, tools: TOOLS[role] });
    expect({ role, toolCount: a.toolCount }).toEqual({
      role,
      toolCount: Object.values(TOOLS[role]).reduce((n, k) => n + (k ?? 0), 0),
    });
    expect({ role, tokens: a.tokens }).toEqual({ role, tokens: TOKENS[role] });
    expect({ role, inflight: Object.keys(a.inflight) }).toEqual({ role, inflight: [] });
  }
  expect(s.agents[agents.main]!.children.sort()).toEqual([agents.explorer, agents.planner].sort());
  expect(s.agents[agents.nested]!.depth).toBe(2);
  expect(s.agents[agents.nested]!.filesTouched).toEqual(["/work/demo/src/auth/login.ts"]);
  return s;
}
