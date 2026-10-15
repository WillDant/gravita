import { providerOfCommands } from "../../domain/terminal-provider";
import type { Logger } from "../ports/logger";
import type { ForegroundProbe } from "../ports/terminal-host";
import type { TerminalManager } from "./terminal-manager";

/** How often the shells are looked at. */
export const ACTIVITY_POLL_MS = 1_500;

/**
 * Tells which agent runs in front in each plain shell terminal (the user typed `claude`,
 * `codex` or `cursor-agent`), and that it is back at the prompt once it exits. The clients
 * show it as the terminal's icon and name.
 */
export class TerminalActivityWatcher {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;

  constructor(
    private readonly terminals: TerminalManager,
    private readonly probe: ForegroundProbe,
    private readonly logger: Logger,
  ) {}

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), ACTIVITY_POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One look at every running shell. */
  async tick(): Promise<void> {
    const shells = this.terminals.shells();
    if (this.busy || shells.length === 0) return;
    this.busy = true;
    try {
      const lines = await this.probe.foreground(shells.map((s) => s.pid));
      for (const { terminalId, pid } of shells) {
        const found = lines.get(pid);
        // No answer for a shell (it just ended, or ps skipped it): leave what is shown.
        if (found) this.terminals.setActiveProvider(terminalId, providerOfCommands(found));
      }
    } catch (err) {
      this.logger.log("terminal activity check failed", err);
    } finally {
      this.busy = false;
    }
  }
}
