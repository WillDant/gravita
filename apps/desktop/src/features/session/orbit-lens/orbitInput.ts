import { effectiveLifecycle, type SessionState, TERMINAL, toPersona } from "@gravita/core";
import type { OrbitAgent, OrbitInput } from "@gravita/orbs";
import { t } from "@/shared/i18n/i18n";
import { agentName } from "@/shared/presenters/agent";

const ms = (ts: string) => Date.parse(ts) || 0;

/**
 * The session as the orbit scene's input, plus each agent's display name and accessible
 * label: its name and the same plain-language persona label the line map's signage shows.
 */
export function orbitInput(
  session: SessionState,
  project: { id: string; name: string },
  now: number,
): { input: OrbitInput; labels: Map<string, string>; names: Map<string, string> } {
  const labels = new Map<string, string>();
  const names = new Map<string, string>();
  const agents: OrbitAgent[] = Object.values(session.agents).map((a) => {
    const persona = toPersona(a, session, now);
    const lifecycle = effectiveLifecycle(a, session, now);
    const name = agentName(a);
    names.set(a.id, name);
    labels.set(a.id, `${name} ${t(persona.label.key, persona.label.params)}`);
    return {
      id: a.id,
      parentId: a.parentId,
      agentType: a.agentType,
      mood: persona.mood,
      lifecycle,
      gaze: persona.gaze,
      glyph: persona.glyph,
      spawnedAt: ms(a.createdTs),
      changedAt: ms(a.lastEventTs),
      ...(TERMINAL.has(lifecycle) ? { endedAt: ms(a.lastEventTs) } : {}),
    };
  });
  return { input: { project, agents }, labels, names };
}
