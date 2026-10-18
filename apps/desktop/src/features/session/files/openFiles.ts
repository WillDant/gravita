import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

// The files open in a project's editor, as tabs. Kept per project folder outside the
// session screen, so leaving a session and coming back finds its tabs (and unsaved edits).

export type OpenFile =
  | { path: string; status: "loading" }
  | { path: string; status: "error"; error: string }
  | { path: string; status: "binary" }
  | { path: string; status: "tooLarge"; size: number }
  | {
      path: string;
      status: "text";
      /** What the editor holds now. */
      text: string;
      /** What is on disk, as last read or saved. */
      saved: string;
      mtimeMs: number;
      saving?: boolean;
      /** The last save was refused because the file changed on disk. */
      conflict?: boolean;
      saveError?: string;
    };

export interface ProjectTabs {
  tabs: OpenFile[];
  active?: string;
}

const EMPTY: ProjectTabs = { tabs: [] };

export const openFilesStore = createStore<Record<string, ProjectTabs>>(() => ({}));

/** Clears every project's tabs (tests). */
export function resetOpenFiles() {
  openFilesStore.setState({}, true);
}

export function useProjectTabs(root: string | undefined): ProjectTabs {
  return useStore(openFilesStore, (s) => (root ? (s[root] ?? EMPTY) : EMPTY));
}

export function getProjectTabs(root: string): ProjectTabs {
  return openFilesStore.getState()[root] ?? EMPTY;
}

export function updateProject(root: string, fn: (p: ProjectTabs) => ProjectTabs) {
  openFilesStore.setState((s) => ({ ...s, [root]: fn(s[root] ?? EMPTY) }));
}

export function updateFile(root: string, path: string, fn: (f: OpenFile) => OpenFile) {
  updateProject(root, (p) => ({
    ...p,
    tabs: p.tabs.map((f) => (f.path === path ? fn(f) : f)),
  }));
}

export const isDirty = (f: OpenFile): boolean => f.status === "text" && f.text !== f.saved;
