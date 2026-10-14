import type { SessionState as ProjectedSession } from "@gravita/core";
import { type GravitaEvent, keys } from "@gravita/protocol";
import type { Clock } from "../ports/clock";
import type {
  HookSignal,
  HookToolCall,
  HookTranslator,
  ParsedHook,
} from "../ports/hook-translator";
import type { Logger } from "../ports/logger";
import type { ProjectionReader } from "../ports/projection-reader";
import type { SessionOwnership } from "../ports/session-runtime";
import type { AnnounceProject } from "../usecases/announce-project";
import type { IngestEvents } from "../usecases/ingest-events";

// Deep Observe: hooks of sessions running in a terminal, forwarded by the user's plugin.
// Tool facts go straight to IngestEvents (same keys as the transcript, so stored once).
// Permission prompts need memory: a hook says a dialog is showing, and only later hooks
// of the same agent tell that it is over. That memory lives here, per session and agent.
//
// Hooks are async, so two that fire a few ms apart may arrive swapped. Hence: a prompt is
// tied to its call by tool use id or by tool + input, a call of another tool only ends a
// prompt once a person could have answered it (RESOLVE_AFTER_MS), and a tool ending
// concurrently with the prompt (a parallel read) never ends it.

/** A person takes longer than this to answer a dialog; earlier signals are reordering. */
export const RESOLVE_AFTER_MS = 1_000;
/** A spooled prompt older than this is history, not something to answer. */
export const SPOOLED_PROMPT_MAX_AGE_MS = 60_000;
/** Calls kept per agent (a denied call never ends, so the list is capped). */
const MAX_OPEN_CALLS = 32;
/** Sessions kept in memory; a session that never sent SessionEnd is dropped eventually. */
const MAX_SESSIONS = 512;
const HOOK_PREFIX = "hook:";

interface Pending {
  requestId: string;
  toolName: string;
  /** Unknown for prompts recovered from the projection after a restart. */
  inputKey?: string;
  toolUseId?: string;
  openedAt: number;
}

interface AgentState {
  open: Map<string, HookToolCall>;
  pending: Map<string, Pending>;
}

interface SessionState {
  projectId: string;
  agents: Map<string, AgentState>;
}

export interface HookIngestDeps {
  translator: HookTranslator;
  ingest: IngestEvents;
  projects: AnnounceProject;
  /** Sessions a Gravita runtime writes itself are never touched by hooks. */
  ownership: SessionOwnership;
  /** To recover prompts that were open when the engine restarted. */
  sessions: ProjectionReader;
  clock: Clock;
  logger: Logger;
}

export interface HookIngestOptions {
  /** Read back from the spool, not live. */
  replay?: boolean;
}

export class HookIngest {
  private readonly state = new Map<string, SessionState>();
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly d: HookIngestDeps) {}

  /** Queues a live hook; hooks are handled one at a time, in arrival order. */
  submit(raw: unknown): void {
    void this.execute(raw);
  }

  /**
   * Hooks queued from now on are dropped (the store is closing). Resolves once the hook
   * being handled, if any, is done.
   */
  close(): Promise<void> {
    this.closed = true;
    return this.chain;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Handles a hook after the ones queued before it. Never rejects. */
  execute(raw: unknown, opts: HookIngestOptions = {}): Promise<void> {
    const run = this.chain.then(() => this.handle(raw, opts));
    this.chain = run.catch((err) => this.d.logger.log("hook ingest failed", err));
    return this.chain;
  }

  private async handle(raw: unknown, opts: HookIngestOptions) {
    if (this.closed) return;
    const hook = this.d.translator.parse(raw);
    if (!hook || this.d.ownership.isOwned(hook.sessionId)) return;
    const at = hook.spooledAt ?? this.d.clock.now();
    const ts = new Date(at).toISOString();
    const session = await this.sessionState(hook, ts);
    if (!session) return;
    // The project lookup awaited: the engine may be closing, or a Gravita runtime may have
    // taken the session meanwhile.
    if (this.closed || this.d.ownership.isOwned(hook.sessionId)) return;

    const m = hook.map({ projectId: session.projectId, ts });
    const events = [...m.events];
    const base = {
      ts,
      source: "hook" as const,
      provider: this.d.translator.provider,
      projectId: session.projectId,
      sessionId: m.sessionId,
    };
    if (m.signal) {
      // A replayed prompt may open only if it is recent: the dialog may still be showing.
      const mayOpen =
        !opts.replay ||
        (hook.spooledAt !== undefined &&
          this.d.clock.now() - hook.spooledAt <= SPOOLED_PROMPT_MAX_AGE_MS);
      const agentBase = { ...base, agentId: m.agentId };
      this.onSignal(m.signal, session, m.agentId, at, mayOpen, agentBase, events);
      if (m.signal.kind === "session-end") this.state.delete(m.sessionId);
    }
    if (events.length) this.d.ingest.execute(events);
  }

  private async sessionState(hook: ParsedHook, ts: string): Promise<SessionState | undefined> {
    const tracked = this.state.get(hook.sessionId);
    if (tracked) return tracked;
    // Copied once per session and engine run: its project, and prompts left open.
    const known = this.d.sessions.session(hook.sessionId);
    let projectId = known?.projectId;
    if (!projectId && hook.cwd) projectId = (await this.d.projects.execute(hook.cwd, ts)).id;
    if (!projectId) return undefined;
    const session: SessionState = { projectId, agents: recoverPrompts(known) };
    if (this.state.size >= MAX_SESSIONS) {
      const oldest = this.state.keys().next().value;
      if (oldest !== undefined) this.state.delete(oldest);
    }
    this.state.set(hook.sessionId, session);
    return session;
  }

  private onSignal(
    signal: HookSignal,
    session: SessionState,
    agentId: string,
    at: number,
    mayOpen: boolean,
    base: Omit<GravitaEvent, "key" | "type" | "data">,
    out: GravitaEvent[],
  ) {
    const resolve = (agent: AgentState, p: Pending, decision: "allow" | "deny", who = base) => {
      agent.pending.delete(p.requestId);
      out.push({
        ...who,
        key: keys.permissionResolved(p.requestId),
        type: "permission.resolved",
        data: { requestId: p.requestId, decision, by: "hook" },
      });
    };

    switch (signal.kind) {
      case "tool-start": {
        const agent = agentOf(session.agents, agentId);
        const { call } = signal;
        for (const p of agent.pending.values()) {
          if (p.toolUseId === call.toolUseId || at < p.openedAt) continue;
          const late = at - p.openedAt >= RESOLVE_AFTER_MS;
          // The call that raised the prompt, arriving after it: tie them.
          if (!p.toolUseId && p.inputKey === call.inputKey && !late) {
            p.toolUseId = call.toolUseId;
            continue;
          }
          if (late) resolve(agent, p, "deny");
        }
        agent.open.delete(call.toolUseId);
        agent.open.set(call.toolUseId, call);
        if (agent.open.size > MAX_OPEN_CALLS) {
          const oldest = agent.open.keys().next().value;
          if (oldest !== undefined) agent.open.delete(oldest);
        }
        return;
      }

      case "tool-end": {
        const agent = agentOf(session.agents, agentId);
        agent.open.delete(signal.toolUseId);
        for (const p of agent.pending.values()) {
          const same = p.toolUseId
            ? p.toolUseId === signal.toolUseId
            : p.inputKey !== undefined && p.inputKey === signal.inputKey;
          if (same && at >= p.openedAt) resolve(agent, p, signal.ok ? "allow" : "deny");
        }
        return;
      }

      case "prompt": {
        if (!mayOpen) return;
        const agent = agentOf(session.agents, agentId);
        const open = [...agent.open.values()].reverse();
        let call: HookToolCall | undefined;
        if (signal.via === "request") {
          call = open.find((c) => c.inputKey === signal.inputKey);
        } else {
          // Claude Code also sent (or will send) PermissionRequest for this dialog.
          if (agent.pending.size) return;
          call = open[0];
          if (!call) return;
        }
        const toolName = signal.toolName ?? call?.toolName;
        const inputKey = signal.inputKey ?? call?.inputKey;
        if (!toolName || !inputKey) return;
        for (const p of agent.pending.values()) {
          // The same dialog, reported twice (request + notification, or a retry).
          if ((call && p.toolUseId === call.toolUseId) || p.inputKey === inputKey) {
            if (call && !p.toolUseId) p.toolUseId = call.toolUseId;
            return;
          }
        }
        const requestId = call
          ? `${HOOK_PREFIX}${call.toolUseId}`
          : `${HOOK_PREFIX}${base.sessionId}:${agentId}:${inputKey}`;
        agent.pending.set(requestId, {
          requestId,
          toolName,
          inputKey,
          ...(call ? { toolUseId: call.toolUseId } : {}),
          openedAt: at,
        });
        out.push({
          ...base,
          key: keys.permissionRequested(requestId),
          type: "permission.requested",
          data: {
            requestId,
            ...(call ? { toolUseId: call.toolUseId } : {}),
            toolName,
            inputPreview: signal.inputPreview ?? call?.inputPreview ?? "",
          },
        });
        return;
      }

      case "turn-end": {
        const agent = session.agents.get(agentId);
        if (!agent) return;
        for (const p of agent.pending.values()) if (at >= p.openedAt) resolve(agent, p, "deny");
        agent.open.clear();
        return;
      }

      case "session-end": {
        for (const [id, agent] of session.agents) {
          for (const p of agent.pending.values())
            resolve(agent, p, "deny", { ...base, agentId: id });
        }
        return;
      }
    }
  }
}

/** Prompts raised by hooks that the projection still shows (the engine restarted). */
function recoverPrompts(s: ProjectedSession | undefined): Map<string, AgentState> {
  const agents = new Map<string, AgentState>();
  for (const a of Object.values(s?.agents ?? {})) {
    for (const p of Object.values(a.permissions ?? {})) {
      if (!p.requestId.startsWith(HOOK_PREFIX)) continue;
      const rest = p.requestId.slice(HOOK_PREFIX.length);
      const opened = Date.parse(p.ts);
      agentOf(agents, a.id).pending.set(p.requestId, {
        requestId: p.requestId,
        toolName: p.toolName,
        // `hook:<toolUseId>`; the fallback ids contain colons.
        ...(rest.includes(":") ? {} : { toolUseId: rest }),
        openedAt: Number.isFinite(opened) ? opened : 0,
      });
    }
  }
  return agents;
}

function agentOf(agents: Map<string, AgentState>, agentId: string): AgentState {
  let a = agents.get(agentId);
  if (!a) {
    a = { open: new Map(), pending: new Map() };
    agents.set(agentId, a);
  }
  return a;
}
