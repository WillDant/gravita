import type { GravitaEvent } from "@gravita/protocol";
import type { TerminalManager } from "./terminal-manager";

// Which session runs in which terminal. A Claude Code terminal knows from the start (it
// passes `--session-id`). Codex has no such flag, and a shell runs whatever the user types:
// the first session observed starting in the terminal's folder after it opened is its own.

/** Clock difference between the engine and a session's own timestamps that still counts. */
export const LINK_SKEW_MS = 2_000;

function samePath(a: string, b: string): boolean {
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
  return trim(a) === trim(b);
}

export class TerminalSessionLinker {
  constructor(private readonly terminals: TerminalManager) {}

  observe(events: readonly GravitaEvent[]): void {
    for (const e of events) {
      if (e.type !== "session.started" || !e.sessionId || e.data.kind !== "external") continue;
      const started = Date.parse(e.ts);
      const candidates = this.terminals
        .running()
        .filter(
          ({ info, startedMs }) =>
            !info.sessionId &&
            (info.command === "shell" || info.command === e.provider) &&
            samePath(info.cwd, e.data.cwd) &&
            started >= startedMs - LINK_SKEW_MS,
        )
        .sort((a, b) => b.startedMs - a.startedMs);
      const newest = candidates[0];
      if (newest) this.terminals.link(newest.info.terminalId, e.sessionId);
    }
  }
}
