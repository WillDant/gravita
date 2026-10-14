import type {
  PtyProcess,
  PtySpawnOptions,
  TerminalHost,
} from "../../application/ports/terminal-host";

/** How long a hung-up process gets to exit before it is killed. */
const KILL_GRACE_MS = 2_000;
/** After the process exits, how long its last output may take to come out of the PTY. */
const DRAIN_MS = 250;

/**
 * Pseudo-terminals from Bun itself (`Bun.spawn` with `terminal`): no native addon, so it
 * compiles into the sidecar. POSIX only. Each process leads its own session, so ending its
 * process group ends what it started too.
 */
export class BunPtyHost implements TerminalHost {
  readonly supported = process.platform !== "win32";

  spawn(o: PtySpawnOptions): PtyProcess {
    const decoder = new TextDecoder();
    let drained!: () => void;
    const ptyClosed = new Promise<void>((resolve) => {
      drained = resolve;
    });
    const proc = Bun.spawn(o.argv, {
      cwd: o.cwd,
      env: o.env,
      terminal: {
        cols: o.cols,
        rows: o.rows,
        name: "xterm-256color",
        data: (_t, bytes) => {
          const text = decoder.decode(bytes, { stream: true });
          if (text) o.onData(text);
        },
        exit: () => drained(),
      },
    });
    let exited = false;
    // The exit is told once the PTY gave everything it had (or soon after, when a background
    // child keeps it open).
    const done = proc.exited.then(async () => {
      exited = true;
      await Promise.race([ptyClosed, Bun.sleep(DRAIN_MS)]);
      const tail = decoder.decode();
      if (tail) o.onData(tail);
      proc.terminal?.close();
      o.onExit(proc.signalCode ? null : proc.exitCode);
    });
    const signal = (sig: NodeJS.Signals) => {
      try {
        process.kill(-proc.pid, sig);
      } catch {
        try {
          proc.kill(sig);
        } catch {}
      }
    };
    return {
      pid: proc.pid,
      write: (data) => {
        if (!exited) proc.terminal?.write(data);
      },
      resize: (cols, rows) => {
        if (!exited) proc.terminal?.resize(cols, rows);
      },
      kill: async () => {
        if (exited) return;
        signal("SIGHUP");
        const timer = setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS);
        await done;
        clearTimeout(timer);
      },
    };
  }
}
