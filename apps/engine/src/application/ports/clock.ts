/** Time and timers, injectable so application code never reads the wall clock itself. */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** `now()` as an ISO 8601 string. */
  iso(): string;
  /** Runs `fn` once after `ms`. Returns a function that cancels it. */
  setTimer(fn: () => void, ms: number): () => void;
}
