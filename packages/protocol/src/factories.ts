import type { EventSource, GravitaEvent } from "./events";
import type { Provider } from "./ids";

export interface ProjectIdentity {
  id: string;
  root: string;
  name: string;
}

/** The one way to announce a project, whatever discovered it. */
export function projectDiscoveredEvent(
  p: ProjectIdentity,
  ts: string,
  origin: { source: EventSource; provider: Provider },
): GravitaEvent {
  return {
    key: `project:${p.id}:discovered`,
    ts,
    source: origin.source,
    provider: origin.provider,
    projectId: p.id,
    type: "project.discovered",
    data: { root: p.root, name: p.name },
  };
}
