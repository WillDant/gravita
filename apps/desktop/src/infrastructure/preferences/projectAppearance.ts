const KEY = "gravita.projectAppearance";

/** The icons a project can wear (`shared/ui/projectIcons.ts` draws each one). */
export const PROJECT_ICON_IDS = [
  "folder",
  "code",
  "terminal",
  "rocket",
  "globe",
  "database",
  "server",
  "cloud",
  "cpu",
  "package",
  "layers",
  "layout",
  "smartphone",
  "bot",
  "brain",
  "bug",
  "wrench",
  "zap",
  "flame",
  "leaf",
  "star",
  "heart",
  "cart",
  "book",
  "music",
  "camera",
  "gamepad",
  "shield",
] as const;
export type ProjectIconId = (typeof PROJECT_ICON_IDS)[number];

/** The tile colours (`styles.css` defines each one for both themes); neutral is the default. */
export const PROJECT_TONE_IDS = [
  "neutral",
  "blue",
  "violet",
  "pink",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
] as const;
export type ProjectToneId = (typeof PROJECT_TONE_IDS)[number];

/** How one project looks; nothing set means the initial of its name on the neutral tile. */
export interface ProjectAppearance {
  icon?: ProjectIconId;
  tone?: ProjectToneId;
}

export type ProjectAppearances = Readonly<Record<string, ProjectAppearance>>;

/** A change to a project's look: a field set to `undefined` goes back to its default. */
export type ProjectAppearancePatch = {
  [K in keyof ProjectAppearance]: ProjectAppearance[K] | undefined;
};

/** Each project's look, remembered in localStorage when it's there (memory only otherwise). */
export interface ProjectAppearanceStore {
  get(): ProjectAppearances;
  set(projectId: string, patch: ProjectAppearancePatch): void;
  reset(projectId: string): void;
  subscribe(listener: () => void): () => void;
}

const isIcon = (v: unknown): v is ProjectIconId =>
  typeof v === "string" && (PROJECT_ICON_IDS as readonly string[]).includes(v);
const isTone = (v: unknown): v is ProjectToneId =>
  typeof v === "string" && (PROJECT_TONE_IDS as readonly string[]).includes(v);

function read(storage: () => Storage): ProjectAppearances {
  try {
    const raw = storage().getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, ProjectAppearance> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const v = value as Record<string, unknown>;
      const appearance: ProjectAppearance = {
        ...(isIcon(v.icon) ? { icon: v.icon } : {}),
        ...(isTone(v.tone) ? { tone: v.tone } : {}),
      };
      if (appearance.icon || appearance.tone) out[id] = appearance;
    }
    return out;
  } catch {
    // No storage, or something unreadable in it: every project at its default.
    return {};
  }
}

export function createProjectAppearance(
  storage: () => Storage = () => localStorage,
): ProjectAppearanceStore {
  let all = read(storage);
  const listeners = new Set<() => void>();
  const commit = (next: ProjectAppearances) => {
    all = next;
    try {
      storage().setItem(KEY, JSON.stringify(all));
    } catch {
      // The choice then lasts for this window only.
    }
    for (const l of listeners) l();
  };
  return {
    get: () => all,
    set(projectId, patch) {
      const merged: ProjectAppearance = { ...all[projectId] };
      if ("icon" in patch) {
        if (patch.icon === undefined) delete merged.icon;
        else if (isIcon(patch.icon)) merged.icon = patch.icon;
      }
      if ("tone" in patch) {
        if (patch.tone === undefined) delete merged.tone;
        else if (isTone(patch.tone)) merged.tone = patch.tone;
      }
      const { [projectId]: _old, ...rest } = all;
      commit(merged.icon || merged.tone ? { ...rest, [projectId]: merged } : rest);
    },
    reset(projectId) {
      const { [projectId]: _old, ...rest } = all;
      commit(rest);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
