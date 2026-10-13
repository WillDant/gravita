import type { Clock } from "../../application/ports/clock";

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  iso(): string {
    return new Date().toISOString();
  }

  setTimer(fn: () => void, ms: number): () => void {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  }
}
