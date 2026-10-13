import type { Slice } from "../store";

export interface ClockSlice {
  /** Wall clock for relative times and staleness, ticked once a second by the app. */
  now: number;
  tick: (now: number) => void;
}

export const createClockSlice =
  (now: number): Slice<ClockSlice> =>
  () =>
  (set) => ({
    now,
    tick: (next) => set({ now: next }),
  });
