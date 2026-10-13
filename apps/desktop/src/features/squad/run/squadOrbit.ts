import { effectiveLifecycle, TERMINAL, toPersona } from "@gravita/core";
import type { OrbitAgent, OrbitInput } from "@gravita/orbs";
import { MAIN_AGENT } from "@gravita/protocol/ids";
import { t } from "@/shared/i18n/i18n";
import { agentName } from "@/shared/presenters/agent";
import type { SquadView } from "../model";

const ms = (ts: string) => Date.parse(ts) || 0;

/** The id a role's agent takes in the squad's orbit: one namespace per role. */
export const orbitId = (roleId: string, agentId: string) => `${roleId}/${agentId}`;

/**
 * The squad as one solar system: the project is the sun, each role's current main agent
 * a planet in the role's hue, its subagents moons. Ids are prefixed per role so two
 * roles' "main" never collide.
 */
export function squadOrbitInput(
  view: SquadView,
  project: { id: string; name: string },
  now: number,
): { input: OrbitInput; labels: Map<string, string>; names: Map<string, string> } {
  const labels = new Map<string, string>();
  const names = new Map<string, string>();
  const agents: OrbitAgent[] = [];
  for (const role of view.roles) {
    const s = role.session;
    if (!s) continue;
    for (const a of Object.values(s.agents)) {
      const persona = toPersona(a, s, now);
      const lifecycle = effectiveLifecycle(a, s, now);
      const id = orbitId(role.id, a.id);
      const name = a.id === MAIN_AGENT ? role.name : `${role.name} › ${agentName(a)}`;
      names.set(id, name);
      labels.set(id, `${name} ${t(persona.label.key, persona.label.params)}`);
      agents.push({
        id,
        parentId: a.parentId ? orbitId(role.id, a.parentId) : null,
        agentType: a.id === MAIN_AGENT ? role.colorKey : a.agentType,
        mood: persona.mood,
        lifecycle,
        gaze: persona.gaze,
        glyph: persona.glyph,
        spawnedAt: ms(a.createdTs),
        changedAt: ms(a.lastEventTs),
        ...(TERMINAL.has(lifecycle) ? { endedAt: ms(a.lastEventTs) } : {}),
      });
    }
  }
  return { input: { project, agents }, labels, names };
}
