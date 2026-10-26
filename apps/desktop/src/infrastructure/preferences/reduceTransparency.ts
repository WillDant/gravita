const KEY = "gravita.reduceTransparency";

/** Whether the menu stays opaque over the window's frosted material (off by default). */
export interface ReduceTransparencyStore {
  get(): boolean;
  set(reduce: boolean): void;
  subscribe(listener: () => void): () => void;
}

function read(storage: () => Storage): boolean {
  try {
    return storage().getItem(KEY) === "true";
  } catch {
    // No storage: the default, translucent.
    return false;
  }
}

/**
 * The choice, remembered in localStorage when it's there (memory only otherwise), and shown
 * on <html> as `data-reduce-transparency` for the stylesheet.
 */
export function createReduceTransparency(
  root: HTMLElement = document.documentElement,
  storage: () => Storage = () => localStorage,
): ReduceTransparencyStore {
  let reduce = read(storage);
  const listeners = new Set<() => void>();
  const apply = () => root.toggleAttribute("data-reduce-transparency", reduce);
  apply();
  return {
    get: () => reduce,
    set(next) {
      reduce = next;
      apply();
      try {
        storage().setItem(KEY, String(next));
      } catch {
        // The choice then lasts for this window only.
      }
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
