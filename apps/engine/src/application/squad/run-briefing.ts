import { pickModel, type SquadState } from "@gravita/core";
import { MAIN_AGENT } from "@gravita/protocol";
import {
  BRIEFING_TOOLS,
  briefingPermission,
  PLANNER_DISALLOWED_TOOLS,
} from "../../domain/autonomy-policy";
import {
  BRIEFING_MAX_TURNS,
  PLANNER_ROLE_ID,
  STOP_GRACE_MS,
  squadEnv,
} from "../../domain/squad-policy";
import type { Clock } from "../ports/clock";
import type { EventStore } from "../ports/event-store";
import type { ProjectionReader } from "../ports/projection-reader";
import type { SquadReader } from "../ports/squad-reader";
import type { TranscriptReader } from "../ports/transcript-reader";
import type { BudgetGuard } from "./budget-guard";
import { BRIEFING_CHARTER, type BriefingLine } from "./prompts";
import type { SquadRun } from "./squad-run";
import type { SquadSession, SquadSessions } from "./squad-sessions";

// The brief as a conversation: before planning, the planner role talks with the user in a
// read-only session (it reads the repository and asks; it never plans or writes). The user
// talks to it like to a chat (session.send, AskUserQuestion through Needs you). When they
// ask for the plan, the conversation ends and the planner resumes this same session, so it
// keeps what it learned.

/** The live briefing session, and a way to wait for the end of its turn in flight. */
export class Briefing {
  private readonly waiters: (() => void)[] = [];

  constructor(readonly session: SquadSession) {
    void this.drain();
  }

  /** Resolves when the next turn ends (or the session does). */
  turnEnd(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Nobody else reads the outcomes: the user drives the turns, not Gravita. */
  private async drain() {
    for (;;) {
      const o = await this.session.nextTurn();
      for (const w of this.waiters.splice(0)) w();
      if (o.kind === "ended") return;
    }
  }
}

export interface RunBriefingDeps {
  sessions: SquadSessions;
  squads: SquadReader;
  projection: ProjectionReader;
  budget: BudgetGuard;
  transcripts: TranscriptReader;
  events: EventStore;
  clock: Clock;
}

export class RunBriefing {
  constructor(private readonly d: RunBriefingDeps) {}

  /** Starts the conversation in `cwd` with the brief as the user's first message. */
  async start(run: SquadRun, cwd: string): Promise<void> {
    const q = this.current(run);
    const session = await this.d.sessions.start({
      squadId: run.squadId,
      projectId: run.projectId,
      roleId: PLANNER_ROLE_ID,
      cwd,
      // A conversation, not the plan: under Automatic a cheaper model than the planning run.
      model: pickModel({ models: q.models, phase: "briefing" }),
      env: squadEnv(q.models),
      // Not "dontAsk": that would deny AskUserQuestion before it reaches the user. The
      // tool list and the policy keep it read-only all the same.
      permissionMode: "default",
      prompt: q.brief,
      systemPromptAppend: BRIEFING_CHARTER,
      tools: [...BRIEFING_TOOLS],
      disallowedTools: [...PLANNER_DISALLOWED_TOOLS],
      maxTurns: BRIEFING_MAX_TURNS,
      maxBudgetUsd: this.d.budget.forBriefing(q),
      permissionPolicy: (tool) => briefingPermission(tool),
    });
    run.briefing = new Briefing(session);
    run.plannerSessionId = session.sessionId;
  }

  /**
   * Ends the conversation so the planner can resume its session: a turn in flight (an
   * answer being written, a question waiting) is interrupted and given a few seconds to
   * end, then the session is closed. Nothing to do when it isn't running (after a restart).
   */
  async end(run: SquadRun): Promise<void> {
    const briefing = run.briefing;
    if (!briefing) return;
    run.briefing = undefined;
    const { session } = briefing;
    session.stopping = true;
    if (this.midTurn(session.sessionId)) {
      const ended = briefing.turnEnd();
      let cancel = () => {};
      const grace = new Promise<void>((resolve) => {
        cancel = this.d.clock.setTimer(resolve, STOP_GRACE_MS);
      });
      await session.runtime.interrupt().catch(() => {});
      await Promise.race([ended, grace]);
      cancel();
    }
    await session.dispose();
  }

  /**
   * The briefing's messages, for a planner that can't resume its session: the full text
   * from Claude Code's transcript when there is one, else the previews Gravita recorded.
   * The briefing session is the planner role's first; none for squads made before briefs.
   */
  async conversation(q: SquadState): Promise<BriefingLine[]> {
    const sessionId = q.roles[PLANNER_ROLE_ID]?.sessionIds[0];
    if (!sessionId) return [];
    const full = await this.d.transcripts.conversation(sessionId).catch(() => []);
    if (full.length) return full.map((m) => ({ role: m.role, text: m.text }));
    return this.d.events.sessionEvents(sessionId).flatMap((e): BriefingLine[] => {
      if (e.agentId !== MAIN_AGENT) return [];
      if (e.type === "message.user" && (e.data.origin === "gravita" || e.data.origin === "human"))
        return [{ role: "user", text: e.data.textPreview }];
      if (e.type === "message.assistant" && e.data.textPreview)
        return [{ role: "assistant", text: e.data.textPreview }];
      return [];
    });
  }

  /** The main agent is answering or waiting on the user (Gravita's events tell). */
  private midTurn(sessionId: string): boolean {
    const lifecycle = this.d.projection.session(sessionId)?.agents[MAIN_AGENT]?.lifecycle;
    return lifecycle === "active" || lifecycle === "waiting_user";
  }

  private current(run: SquadRun): SquadState {
    const q = this.d.squads.squad(run.squadId);
    if (!q) throw new Error(`No squad ${run.squadId}`);
    return q;
  }
}
