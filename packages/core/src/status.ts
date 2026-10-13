import type { ToolKind } from "@gravita/protocol";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import type { AgentNode, InflightTool, Lifecycle, SessionState } from "./state";
import { TERMINAL } from "./state";

/** What an active agent is doing right now, derived from in-flight tools and timing. */
export type Activity =
  | "reading"
  | "searching"
  | "editing"
  | "running"
  | "browsing"
  | "delegating"
  | "using-tool"
  | "planning"
  | "asking"
  | "talking"
  | "thinking"
  | "watching"
  | "drowsy";

const ACTIVITY_BY_KIND: Record<ToolKind, Activity> = {
  read: "reading",
  search: "searching",
  edit: "editing",
  write: "editing",
  bash: "running",
  web: "browsing",
  agent: "delegating",
  mcp: "using-tool",
  todo: "planning",
  ask: "asking",
  plan: "planning",
  other: "using-tool",
};

/** Without any event for this long, a live agent looks drowsy. */
export const DROWSY_MS = 5 * 60_000;
/** A session that isn't live and has been quiet this long is treated as detached. */
export const STALE_MS = 10 * 60_000;
/**
 * A session counts as "recently live" for this long after its last event: the engine
 * polls it as hot, the UI keeps its "now" rule. One value for every layer.
 */
export const LIVE_WINDOW_MS = STALE_MS;

/** True while a session is live or was active within the live window. */
export function isRecentlyLive(s: { live: boolean; lastEventTs: string }, now: number): boolean {
  return s.live || now - (Date.parse(s.lastEventTs) || 0) < LIVE_WINDOW_MS;
}
/** Text written in the last few seconds counts as "talking". */
const TALKING_MS = 4_000;

const ms = (ts: string | undefined) => (ts ? Date.parse(ts) || 0 : 0);

/** Lifecycle as the UI should show it at `now`, accounting for stale, non-live sessions. */
export function effectiveLifecycle(a: AgentNode, s: SessionState, now: number): Lifecycle {
  if (TERMINAL.has(a.lifecycle) || a.lifecycle === "detached") return a.lifecycle;
  if (!s.live && now - ms(s.lastEventTs) > STALE_MS) {
    // History or a closed terminal: the main agent simply rests; unfinished subagents detach.
    return a.id === MAIN_AGENT ? "idle" : "detached";
  }
  return a.lifecycle;
}

function newestInflight(a: AgentNode): InflightTool | undefined {
  let newest: InflightTool | undefined;
  for (const t of Object.values(a.inflight)) {
    if (!newest || t.startedTs > newest.startedTs) newest = t;
  }
  return newest;
}

export function activityOf(a: AgentNode, s: SessionState, now: number): Activity | undefined {
  if (effectiveLifecycle(a, s, now) !== "active") return undefined;
  const tool = newestInflight(a);
  if (tool) return ACTIVITY_BY_KIND[tool.kind];
  if (a.lastTalkTs && now - ms(a.lastTalkTs) < TALKING_MS) return "talking";
  const hasLiveChild = a.children.some((c) => {
    const child = s.agents[c];
    return child ? effectiveLifecycle(child, s, now) === "active" : false;
  });
  if (hasLiveChild) return "watching";
  if (now - ms(a.lastEventTs) > DROWSY_MS) return "drowsy";
  return "thinking";
}

export type Mood =
  | "idle"
  | "thinking"
  | "focused"
  | "busy"
  | "delegating"
  | "waiting"
  | "blocked"
  | "error"
  | "done"
  | "stopped"
  | "away";

export type Gaze =
  | { kind: "wander" }
  | { kind: "tool"; toolKind: ToolKind }
  | { kind: "child"; agentId: string }
  | { kind: "viewer" }
  | { kind: "up" }
  | { kind: "closed" };

export interface Persona {
  lifecycle: Lifecycle;
  activity?: Activity;
  mood: Mood;
  gaze: Gaze;
  /** Short glyph id for colorblind-safe state (paired with the label). */
  glyph: string;
  /** i18n key for the plain-language label, plus params. */
  label: { key: string; params: Record<string, string> };
  /** 0..1, how lively the animation should be. */
  intensity: number;
}

function fileName(path: string | undefined): string | undefined {
  return path?.split(/[\\/]/).filter(Boolean).at(-1);
}

function toolParams(tool: InflightTool | undefined): Record<string, string> {
  if (!tool) return {};
  const t = tool.target;
  const target = fileName(t.path) ?? t.cmd ?? t.query ?? t.url ?? t.agentType ?? tool.name;
  return { target: target.length > 60 ? `${target.slice(0, 59)}…` : target, tool: tool.name };
}

/** Maps an agent node to everything the persona animation and narration need. Pure. */
export function toPersona(a: AgentNode, s: SessionState, now: number): Persona {
  const lifecycle = effectiveLifecycle(a, s, now);
  const activity = activityOf(a, s, now);
  const tool = newestInflight(a);

  switch (lifecycle) {
    case "waiting_user":
      return {
        lifecycle,
        mood: "waiting",
        gaze: { kind: "viewer" },
        glyph: "hand",
        label: { key: "persona.waiting", params: toolParams(a.lastTool) },
        intensity: 1,
      };
    case "blocked":
      return {
        lifecycle,
        mood: "blocked",
        gaze: { kind: "wander" },
        glyph: "pause",
        label: { key: "persona.blocked", params: {} },
        intensity: 0.2,
      };
    case "paused":
      return {
        lifecycle,
        mood: "idle",
        gaze: { kind: "closed" },
        glyph: "pause",
        label: { key: "persona.paused", params: {} },
        intensity: 0.1,
      };
    case "failed":
      return {
        lifecycle,
        mood: "error",
        gaze: { kind: "wander" },
        glyph: "alert",
        label: { key: "persona.failed", params: {} },
        intensity: 0.6,
      };
    case "done":
      return {
        lifecycle,
        mood: "done",
        gaze: { kind: "closed" },
        glyph: "check",
        label: { key: "persona.done", params: {} },
        intensity: 0.15,
      };
    case "stopped":
      return {
        lifecycle,
        mood: "stopped",
        gaze: { kind: "closed" },
        glyph: "stop",
        label: { key: "persona.stopped", params: {} },
        intensity: 0,
      };
    case "detached":
      return {
        lifecycle,
        mood: "away",
        gaze: { kind: "closed" },
        glyph: "unlink",
        label: { key: "persona.detached", params: {} },
        intensity: 0,
      };
    case "idle":
    case "queued":
      return {
        lifecycle,
        mood: "idle",
        gaze: { kind: "wander" },
        glyph: "dot",
        label: { key: lifecycle === "queued" ? "persona.queued" : "persona.idle", params: {} },
        intensity: 0.15,
      };
    case "active":
      break;
  }

  switch (activity) {
    case "delegating": {
      const liveChild = a.children.at(-1);
      return {
        lifecycle,
        activity,
        mood: "delegating",
        gaze: liveChild
          ? { kind: "child", agentId: liveChild }
          : { kind: "tool", toolKind: "agent" },
        glyph: "branch",
        label: { key: "persona.delegating", params: toolParams(tool) },
        intensity: 0.8,
      };
    }
    case "watching": {
      const liveChild = a.children.find(
        (c) => s.agents[c] && effectiveLifecycle(s.agents[c]!, s, now) === "active",
      );
      return {
        lifecycle,
        activity,
        mood: "idle",
        gaze: liveChild ? { kind: "child", agentId: liveChild } : { kind: "wander" },
        glyph: "eye",
        label: { key: "persona.watching", params: { count: String(a.children.length) } },
        intensity: 0.35,
      };
    }
    case "thinking":
      return {
        lifecycle,
        activity,
        mood: "thinking",
        gaze: { kind: "up" },
        glyph: "spark",
        label: { key: "persona.thinking", params: {} },
        intensity: 0.5,
      };
    case "talking":
      return {
        lifecycle,
        activity,
        mood: "focused",
        gaze: { kind: "viewer" },
        glyph: "bubble",
        label: { key: "persona.talking", params: {} },
        intensity: 0.6,
      };
    case "drowsy":
      return {
        lifecycle,
        activity,
        mood: "idle",
        gaze: { kind: "closed" },
        glyph: "moon",
        label: { key: "persona.drowsy", params: {} },
        intensity: 0.1,
      };
    case undefined:
      return {
        lifecycle,
        mood: "thinking",
        gaze: { kind: "up" },
        glyph: "spark",
        label: { key: "persona.thinking", params: {} },
        intensity: 0.5,
      };
    default: {
      const kind = tool?.kind ?? "other";
      const glyphs: Record<string, string> = {
        reading: "file",
        searching: "search",
        editing: "pencil",
        running: "terminal",
        browsing: "globe",
        "using-tool": "plug",
        planning: "list",
        asking: "question",
      };
      return {
        lifecycle,
        activity,
        mood: activity === "editing" || activity === "running" ? "busy" : "focused",
        gaze: { kind: "tool", toolKind: kind },
        glyph: glyphs[activity] ?? "dot",
        label: { key: `persona.${activity}`, params: toolParams(tool) },
        intensity: activity === "running" ? 0.9 : 0.7,
      };
    }
  }
}

export interface SessionCounts {
  /** Agents (main + subagents) currently working. */
  running: number;
  /** Subagents currently working. */
  subagents: number;
  /** Agents waiting for the user. */
  waiting: number;
  /** All subagents ever spawned in the session. */
  subagentsTotal: number;
}

/** Counts with the same meaning on every screen (Home, Project, Session). */
export function sessionCounts(s: SessionState, now: number): SessionCounts {
  const counts: SessionCounts = { running: 0, subagents: 0, waiting: 0, subagentsTotal: 0 };
  for (const a of Object.values(s.agents)) {
    const lc = effectiveLifecycle(a, s, now);
    if (a.id !== MAIN_AGENT) counts.subagentsTotal++;
    if (lc === "active") {
      counts.running++;
      if (a.id !== MAIN_AGENT) counts.subagents++;
    } else if (lc === "waiting_user") {
      counts.waiting++;
    }
  }
  return counts;
}
