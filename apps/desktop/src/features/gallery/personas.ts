import {
  type AgentNode,
  DROWSY_MS,
  type Lifecycle,
  type Persona,
  type SessionState,
  toPersona,
  ZERO_TOKENS,
} from "@gravita/core";
import type { ToolKind } from "@gravita/protocol";

// Every persona toPersona can produce, from minimal fixtures typed with the core types:
// each lifecycle crossed with each way an agent can be busy, de-duplicated by what the
// orb draws (mood, gaze, glyph). The gallery and its test both read this list.

const NOW = Date.parse("2026-10-12T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const LIFECYCLES: Lifecycle[] = [
  "queued",
  "active",
  "idle",
  "waiting_user",
  "paused",
  "blocked",
  "done",
  "failed",
  "stopped",
  "detached",
];

const TOOLS: Record<ToolKind, { name: string; target: AgentNode["inflight"][string]["target"] }> = {
  read: { name: "Read", target: { path: "/repo/src/app.ts" } },
  search: { name: "Grep", target: { query: "createSession" } },
  edit: { name: "Edit", target: { path: "/repo/src/app.ts" } },
  write: { name: "Write", target: { path: "/repo/docs/plan.md" } },
  bash: { name: "Bash", target: { cmd: "pnpm test" } },
  web: { name: "WebFetch", target: { url: "https://example.com" } },
  agent: { name: "Agent", target: { agentType: "Explore" } },
  mcp: { name: "mcp__github__search_issues", target: {} },
  todo: { name: "TodoWrite", target: {} },
  ask: { name: "AskUserQuestion", target: {} },
  plan: { name: "ExitPlanMode", target: {} },
  other: { name: "Skill", target: {} },
};

function agent(id: string, lifecycle: Lifecycle): AgentNode {
  return {
    id,
    sessionId: "gallery",
    parentId: id === "main" ? null : "main",
    depth: id === "main" ? 0 : 1,
    agentType: id === "main" ? "main" : "Explore",
    background: false,
    lifecycle,
    createdTs: iso(60_000),
    lastEventTs: iso(1_000),
    inflight: {},
    toolCount: 0,
    filesTouched: [],
    tokens: { ...ZERO_TOKENS },
    children: [],
    pendingPermissions: [],
    permissions: {},
    questions: {},
  };
}

/** How the agent is busy: a tool in flight, talking, watching a child, gone quiet… */
type Setup = (a: AgentNode, agents: Record<string, AgentNode>) => void;

const withChild: Setup = (a, agents) => {
  agents.child = agent("child", "active");
  a.children = ["child"];
};

const SETUPS: Setup[] = [
  () => {},
  ...Object.entries(TOOLS).map(
    ([kind, tool]): Setup =>
      (a) => {
        a.inflight.t1 = {
          toolUseId: "t1",
          name: tool.name,
          kind: kind as ToolKind,
          target: tool.target,
          inputPreview: tool.name,
          startedTs: iso(500),
        };
      },
  ),
  (a, agents) => {
    a.inflight.t1 = {
      toolUseId: "t1",
      name: "Agent",
      kind: "agent",
      target: { agentType: "Explore" },
      inputPreview: "Explore",
      startedTs: iso(500),
    };
    withChild(a, agents);
  },
  (a) => {
    a.lastTalkTs = iso(1_000);
  },
  withChild,
  (a) => {
    a.lastEventTs = iso(DROWSY_MS + 60_000);
  },
  (a) => {
    a.questions.q1 = {
      requestId: "q1",
      questions: [{ question: "Which database?", multiSelect: false, options: [] }],
      ts: iso(1_000),
    };
  },
];

export interface GalleryPersona {
  /** "mood · gaze · glyph": what makes two personas look different. */
  id: string;
  persona: Persona;
}

export function galleryPersonas(): GalleryPersona[] {
  const out = new Map<string, GalleryPersona>();
  for (const lifecycle of LIFECYCLES) {
    for (const setup of SETUPS) {
      const a = agent("main", lifecycle);
      const agents: Record<string, AgentNode> = { main: a };
      setup(a, agents);
      const session: SessionState = {
        id: "gallery",
        projectId: "gallery",
        provider: "claude",
        kind: "chat",
        cwd: "/repo",
        startedTs: iso(60_000),
        lastEventTs: iso(1_000),
        live: true,
        controllable: false,
        ended: false,
        agents,
        usage: {},
        version: 0,
      };
      const persona = toPersona(a, session, NOW);
      const id = `${persona.mood} · ${persona.gaze.kind} · ${persona.glyph}`;
      if (!out.has(id)) out.set(id, { id, persona });
    }
  }
  return [...out.values()];
}
