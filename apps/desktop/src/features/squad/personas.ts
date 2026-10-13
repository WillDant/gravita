import {
  type AgentNode,
  effectiveLifecycle,
  type Persona,
  type SessionState,
  toPersona,
} from "@gravita/core";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import { t } from "@/shared/i18n/i18n";

/** A role with no session yet (or the planner before it starts): eyes closed, at rest. */
export const RESTING: Persona = {
  lifecycle: "idle",
  mood: "idle",
  gaze: { kind: "closed" },
  glyph: "dot",
  label: { key: "persona.queued", params: {} },
  intensity: 0,
};

/** A role on the Board, before anything runs: awake, looking around. */
export const IDLE: Persona = { ...RESTING, gaze: { kind: "wander" } };

export interface SessionHead {
  node: AgentNode;
  persona: Persona;
  /** Translated persona label ("is editing app.ts"). */
  label: string;
  /** The session is working or waiting on the user right now. */
  live: boolean;
  held: boolean;
  askTool?: string;
}

/** Where a session's main agent stands now, for a head orb, a row or a planet. */
export function sessionHead(
  session: SessionState | undefined,
  now: number,
): SessionHead | undefined {
  const node = session?.agents[MAIN_AGENT];
  if (!session || !node) return undefined;
  const persona = toPersona(node, session, now);
  const lifecycle = effectiveLifecycle(node, session, now);
  const held =
    lifecycle === "waiting_user" ||
    Object.values(session.agents).some(
      (a) => effectiveLifecycle(a, session, now) === "waiting_user",
    );
  const ask = Object.values(session.agents)
    .flatMap((a) => Object.values(a.permissions ?? {}))
    .at(0);
  return {
    node,
    persona,
    label: t(persona.label.key, persona.label.params),
    live: lifecycle === "active" || held,
    held,
    ...(ask ? { askTool: ask.toolName } : {}),
  };
}
