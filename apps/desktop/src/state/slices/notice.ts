import type { Slice } from "../store";

/** A short, calm line the app shows on its own (e.g. after the tray's kill switch). */
export interface Notice {
  id: number;
  /** i18n key and params, so the line follows a language switch. */
  key: string;
  params?: Record<string, string | number>;
}

export interface NoticeSlice {
  notice?: Notice;
  showNotice: (key: string, params?: Record<string, string | number>) => void;
  /** Clears the notice if it's still `id` (a newer one stays). */
  dismissNotice: (id: number) => void;
}

let nextId = 1;

export const createNoticeSlice: Slice<NoticeSlice> = () => (set, get) => ({
  showNotice: (key, params) =>
    set({ notice: { id: nextId++, key, ...(params ? { params } : {}) } }),
  dismissNotice: (id) => {
    if (get().notice?.id === id) set({ notice: undefined });
  },
});
