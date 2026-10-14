import type { GravitaEvent } from "@gravita/protocol";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import { advanceMeter, isCounting, isPlanWindow, meterKey } from "./squad/plan-usage";
import { applySquad, linkSquadSession, recomputeSpend } from "./squad/projection";
import {
  type AgentNode,
  type GravitaState,
  type Lifecycle,
  type ProjectState,
  type SessionState,
  TERMINAL,
  type Tokens,
  usageKey,
  ZERO_TOKENS,
} from "./state";

const later = (a: string, b: string) => (b > a ? b : a);

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function ensureProject(state: GravitaState, id: string, root: string, ts: string): ProjectState {
  let p = state.projects[id];
  if (!p) {
    p = { id, name: basename(root), root, sessionIds: [], lastEventTs: ts };
    state.projects[id] = p;
  }
  return p;
}

function newAgent(sessionId: string, id: string, ts: string, parentId: string | null): AgentNode {
  return {
    id,
    sessionId,
    parentId,
    depth: parentId === null ? 0 : 1,
    agentType: id === MAIN_AGENT ? "main" : "general-purpose",
    background: false,
    lifecycle: "active",
    createdTs: ts,
    lastEventTs: ts,
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

function ensureSession(state: GravitaState, e: GravitaEvent): SessionState | undefined {
  if (!e.sessionId) return undefined;
  let s = state.sessions[e.sessionId];
  if (!s) {
    s = {
      id: e.sessionId,
      projectId: e.projectId,
      provider: e.provider,
      kind: "external",
      cwd: "",
      startedTs: e.ts,
      lastEventTs: e.ts,
      live: false,
      controllable: false,
      ended: false,
      agents: { [MAIN_AGENT]: newAgent(e.sessionId, MAIN_AGENT, e.ts, null) },
      usage: {},
      version: 0,
    };
    state.sessions[e.sessionId] = s;
    const p = ensureProject(state, e.projectId, e.projectId, e.ts);
    if (!p.sessionIds.includes(s.id)) p.sessionIds.push(s.id);
  }
  return s;
}

function ensureAgent(s: SessionState, id: string, ts: string): AgentNode {
  let a = s.agents[id];
  if (!a) {
    // Events can arrive before agent.spawned (e.g. a subagent file read first).
    // Attach to main until the spawn event tells us the real parent.
    a = newAgent(s.id, id, ts, MAIN_AGENT);
    s.agents[id] = a;
    const main = s.agents[MAIN_AGENT];
    if (main && !main.children.includes(id)) main.children.push(id);
  }
  return a;
}

function reparent(s: SessionState, a: AgentNode, parentId: string) {
  if (a.parentId === parentId) return;
  const old = a.parentId ? s.agents[a.parentId] : undefined;
  if (old) old.children = old.children.filter((c) => c !== a.id);
  a.parentId = parentId;
  const parent = s.agents[parentId] ?? ensureAgent(s, parentId, a.createdTs);
  if (!parent.children.includes(a.id)) parent.children.push(a.id);
}

function setLifecycle(a: AgentNode, next: Lifecycle) {
  // Terminal states are sticky: a late "running" record must not resurrect a done agent.
  if (TERMINAL.has(a.lifecycle) && !TERMINAL.has(next)) return;
  a.lifecycle = next;
}

function addUsage(s: SessionState, a: AgentNode, messageId: string, t: Tokens) {
  const perAgent = s.usage[a.id] ?? {};
  s.usage[a.id] = perAgent;
  const prev = perAgent[messageId];
  if (prev && prev.output >= t.output) return;
  const base = prev ?? ZERO_TOKENS;
  a.tokens = {
    input: a.tokens.input - base.input + t.input,
    output: a.tokens.output - base.output + t.output,
    cacheRead: a.tokens.cacheRead - base.cacheRead + t.cacheRead,
    cacheWrite: a.tokens.cacheWrite - base.cacheWrite + t.cacheWrite,
  };
  perAgent[messageId] = t;
}

/** A squad session's cost changed: refresh its role's and squad's spend. */
function squadSpend(state: GravitaState, s: SessionState) {
  const q = s.squadId ? state.squads[s.squadId] : undefined;
  if (q) recomputeSpend(state, q);
}

/**
 * Applies one event to the state (mutating, for speed). Deterministic and
 * order-tolerant: applying the same set of events in source order always yields the
 * same projection, and duplicates are filtered upstream by idempotency keys.
 */
export function apply(state: GravitaState, e: GravitaEvent): void {
  // Snapshots from before squads (and before plan usage) lack the maps.
  state.squads ??= {};
  state.usage ??= {};
  if (e.type === "usage.limits") {
    applyUsage(state, e);
    return;
  }
  if (e.type === "project.discovered") {
    const p = ensureProject(state, e.projectId, e.data.root, e.ts);
    p.name = e.data.name;
    p.root = e.data.root;
    p.lastEventTs = later(p.lastEventTs, e.ts);
    return;
  }

  if (applySquad(state, e)) {
    const p = state.projects[e.projectId];
    if (p) p.lastEventTs = later(p.lastEventTs, e.ts);
    return;
  }

  const s = ensureSession(state, e);
  if (!s) return;
  s.version++;
  s.lastEventTs = later(s.lastEventTs, e.ts);
  const project = state.projects[s.projectId];
  if (project) project.lastEventTs = later(project.lastEventTs, e.ts);
  const agentId = e.agentId ?? MAIN_AGENT;

  switch (e.type) {
    case "session.started": {
      s.kind = e.data.kind;
      s.cwd = e.data.cwd;
      if (e.data.gitBranch) s.gitBranch = e.data.gitBranch;
      // Codex rollouts name the model up front; a later session.settings still wins.
      if (e.data.model && !s.model) s.model = e.data.model;
      if (e.ts && (!s.startedTs || e.ts < s.startedTs)) s.startedTs = e.ts;
      if (project && project.root === project.id) {
        project.root = e.data.cwd;
        project.name = basename(e.data.cwd);
      }
      if (e.data.squadId) {
        s.squadId = e.data.squadId;
        if (e.data.roleId) s.roleId = e.data.roleId;
        if (e.data.taskId) s.taskId = e.data.taskId;
        linkSquadSession(state, e.data.squadId, s.id, e.data.roleId, s.projectId, e.ts);
      }
      return;
    }
    case "session.titled":
      s.title = e.data.title;
      return;
    case "session.presence":
      s.presence = e.data.status;
      s.live = true;
      return;
    case "session.detached":
      s.live = false;
      for (const a of Object.values(s.agents)) {
        if (!TERMINAL.has(a.lifecycle)) a.lifecycle = "detached";
        a.inflight = {};
      }
      return;
    case "session.settings":
      if (e.data.model !== undefined) s.model = e.data.model;
      if (e.data.permissionMode !== undefined) s.permissionMode = e.data.permissionMode;
      return;
    case "session.control":
      s.controllable = e.data.controllable;
      return;
    case "session.ended":
      s.live = false;
      s.ended = true;
      s.controllable = false;
      return;
    case "turn.completed": {
      const main = ensureAgent(s, MAIN_AGENT, e.ts);
      main.inflight = {};
      setLifecycle(main, "idle");
      main.lastEventTs = later(main.lastEventTs, e.ts);
      if (e.data.costUsd !== undefined) s.costUsd = (s.costUsd ?? 0) + e.data.costUsd;
      squadSpend(state, s);
      return;
    }
    case "cost.snapshot":
      // Cumulative per session; a crash result may report 0, which must not undo spend.
      s.costUsd = Math.max(s.costUsd ?? 0, e.data.totalCostUsd);
      squadSpend(state, s);
      return;
  }

  const a = ensureAgent(s, agentId, e.ts);
  a.lastEventTs = later(a.lastEventTs, e.ts);

  switch (e.type) {
    case "agent.spawned": {
      a.agentType = e.data.agentType;
      if (e.data.description) a.description = e.data.description;
      a.background = e.data.background;
      if (e.data.model) a.model = e.data.model;
      if (e.ts && (!a.createdTs || e.ts < a.createdTs)) a.createdTs = e.ts;
      reparent(s, a, e.data.parentAgentId);
      const parent = s.agents[e.data.parentAgentId];
      a.depth = parent ? parent.depth + 1 : e.data.depth;
      return;
    }
    case "agent.progress":
      if (e.data.summary) a.summary = e.data.summary;
      return;
    case "agent.lifecycle": {
      const map: Record<string, Lifecycle> = {
        pending: "queued",
        running: "active",
        paused: "paused",
        completed: "done",
        failed: "failed",
        killed: "stopped",
      };
      setLifecycle(a, map[e.data.status] ?? a.lifecycle);
      return;
    }
    case "agent.completed": {
      const map: Record<string, Lifecycle> = {
        completed: "done",
        failed: "failed",
        killed: "stopped",
        stopped: "stopped",
      };
      setLifecycle(a, map[e.data.status] ?? "done");
      a.inflight = {};
      if (e.data.summary) a.summary = e.data.summary;
      return;
    }
    case "message.user":
      // A prompt typed in the terminal ("human") or in Gravita's composer ("gravita").
      if (agentId === MAIN_AGENT && (e.data.origin === "human" || e.data.origin === "gravita")) {
        setLifecycle(a, "active");
        if (!s.firstUserText) s.firstUserText = e.data.textPreview;
      }
      return;
    case "message.assistant":
      a.lastTalkTs = e.ts;
      if (a.lifecycle === "idle" || a.lifecycle === "detached") a.lifecycle = "active";
      return;
    case "thinking":
      if (a.lifecycle === "idle") a.lifecycle = "active";
      return;
    case "tool.started": {
      const tool = {
        toolUseId: e.data.toolUseId,
        name: e.data.name,
        kind: e.data.kind,
        target: e.data.target,
        inputPreview: e.data.inputPreview,
        startedTs: e.ts,
      };
      a.inflight[e.data.toolUseId] = tool;
      a.lastTool = tool;
      a.toolCount++;
      if (a.lifecycle === "idle" || a.lifecycle === "detached") a.lifecycle = "active";
      return;
    }
    case "tool.completed": {
      // A tool result can be recorded by a different file than its start (rare); clear everywhere.
      for (const node of Object.values(s.agents)) delete node.inflight[e.data.toolUseId];
      for (const f of e.data.fileChanges ?? []) {
        if (!a.filesTouched.includes(f.path)) a.filesTouched.push(f.path);
      }
      return;
    }
    case "usage.reported":
      addUsage(s, a, e.data.messageId, {
        input: e.data.input,
        output: e.data.output,
        cacheRead: e.data.cacheRead,
        cacheWrite: e.data.cacheWrite,
      });
      return;
    case "permission.requested":
      if (!a.pendingPermissions.includes(e.data.requestId))
        a.pendingPermissions.push(e.data.requestId);
      // Snapshots from an older engine may lack the field.
      a.permissions ??= {};
      a.permissions[e.data.requestId] = {
        requestId: e.data.requestId,
        toolName: e.data.toolName,
        inputPreview: e.data.inputPreview,
        ts: e.ts,
      };
      setLifecycle(a, "waiting_user");
      return;
    case "permission.resolved":
      a.pendingPermissions = a.pendingPermissions.filter((r) => r !== e.data.requestId);
      if (a.permissions) delete a.permissions[e.data.requestId];
      if (
        a.pendingPermissions.length === 0 &&
        Object.keys(a.questions ?? {}).length === 0 &&
        a.lifecycle === "waiting_user"
      )
        a.lifecycle = "active";
      return;
    case "question.asked":
      a.questions ??= {};
      a.questions[e.data.requestId] = {
        requestId: e.data.requestId,
        questions: e.data.questions,
        ts: e.ts,
      };
      setLifecycle(a, "waiting_user");
      return;
    case "question.answered":
      if (a.questions) delete a.questions[e.data.requestId];
      if (
        a.lifecycle === "waiting_user" &&
        a.pendingPermissions.length === 0 &&
        Object.keys(a.questions ?? {}).length === 0
      )
        a.lifecycle = "active";
      return;
    case "error":
    case "notification":
    case "todo.updated":
    case "compact.happened":
      return;
  }
}

/**
 * Keeps the latest reading of a plan window and moves every plan squad's meter of that
 * provider and window. Account-wide: it belongs to no session or project. An older reading
 * than the one kept changes nothing.
 */
function applyUsage(state: GravitaState, e: Extract<GravitaEvent, { type: "usage.limits" }>) {
  const d = e.data;
  const key = usageKey(d.provider, d.window, d.model);
  const prev = state.usage[key];
  if (prev && prev.ts > e.ts) return;
  state.usage[key] = {
    provider: d.provider,
    window: d.window,
    ...(d.model ? { model: d.model } : {}),
    usedPercent: d.usedPercent,
    ...(d.resetsAt ? { resetsAt: d.resetsAt } : {}),
    ...(d.planType ? { planType: d.planType } : {}),
    ...(d.status ? { status: d.status } : {}),
    ts: e.ts,
  };
  if (d.model || !isPlanWindow(d.window)) return;
  const sample = {
    usedPercent: d.usedPercent,
    ts: e.ts,
    ...(d.resetsAt ? { resetsAt: d.resetsAt } : {}),
  };
  for (const q of Object.values(state.squads)) {
    if (!isCounting(q)) continue;
    const meters = q.budget.meters;
    const m = meters?.[meterKey(d.provider, d.window)];
    if (meters && m) meters[meterKey(d.provider, d.window)] = advanceMeter(m, sample);
  }
}

export function applyAll(state: GravitaState, events: Iterable<GravitaEvent>): GravitaState {
  for (const e of events) apply(state, e);
  return state;
}
