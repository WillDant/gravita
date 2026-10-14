import { spawn } from "node:child_process";
import type { RpcTransport } from "@gravita/adapter-codex";
import type { Logger } from "../../application/ports/logger";

// One `codex app-server` child: newline-delimited JSON-RPC on its stdin/stdout. It runs in
// a process group of its own, so stopping it also stops whatever it started (commands,
// MCP servers) and nothing outlives the chat. It is the user's own `codex`, with their own
// login; Gravita reads no credentials.

export interface AppServerProcess {
  transport: RpcTransport;
  /** The exit code (null when killed by a signal or it never started). */
  exited: Promise<number | null>;
  /** Signals the whole process group. */
  kill(signal?: NodeJS.Signals): void;
}

export interface LaunchOptions {
  cliPath: string;
  cwd: string;
  env: Record<string, string>;
}

/** Starts an app-server; tests replace it with a scripted one. */
export type AppServerLauncher = (o: LaunchOptions) => AppServerProcess;

/** The real launcher. `debug` logs the first line of what Codex writes to stderr. */
export function spawnAppServer(logger: Logger, debug = false): AppServerLauncher {
  return ({ cliPath, cwd, env }) => {
    const child = spawn(cliPath, ["app-server"], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      // Its own process group (setsid): killing -pid reaches everything it started.
      detached: true,
    });
    const exited = new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
      child.once("error", (err) => {
        logger.log("codex app-server failed to start", err);
        child.stdout?.destroy();
        resolve(null);
      });
    });
    child.stderr?.on("data", (data: Buffer) => {
      if (!debug) return;
      const line = data.toString("utf8").split("\n")[0]?.slice(0, 200) ?? "";
      logger.log(`codex stderr [${child.pid}] ${line}`);
    });
    // A write after it died must not crash the engine; the connection notices the close.
    child.stdin?.on("error", () => {});
    return {
      transport: {
        incoming: child.stdout!,
        send: (line) => {
          child.stdin?.write(line);
        },
        close: () => {
          child.stdin?.end();
        },
      },
      exited,
      kill: (signal = "SIGTERM") => {
        // The group may outlive its leader (a command Codex started): signal it regardless.
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, signal);
        } catch {
          // The group is gone (or was never made): the child alone, if it is still there.
          try {
            child.kill(signal);
          } catch {}
        }
      },
    };
  };
}

/**
 * Stops an app-server: closes its input (Codex exits on end of input), then signals its
 * group, harder after half the cap. Resolves when it exited, or after `capMs` at most.
 */
export async function stopAppServer(p: AppServerProcess, capMs: number): Promise<void> {
  p.transport.close();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = (ms: number) =>
    Promise.race([
      p.exited.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  const closed = await wait(Math.min(250, capMs / 4));
  // Whatever it started goes too, even when it exited on its own.
  p.kill("SIGTERM");
  if (closed || (await wait(capMs / 2))) return;
  p.kill("SIGKILL");
  await wait(capMs / 4);
}
