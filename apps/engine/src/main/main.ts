import { randomBytes } from "node:crypto";
import { parseArgs } from "./args";
import { type RunningEngine, startEngine, stderrLogger } from "./container";

// gravita-engine: the local sidecar. Prints exactly one JSON line on stdout when ready:
// {"event":"ready","port":<n>,"token":"<hex>","pid":<pid>} (token omitted with --token-stdin).

/** Reads the token from the first stdin line; `onEof` fires when the parent closes stdin. */
async function readStdinToken(onEof: () => void): Promise<string> {
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error("stdin closed before a token was sent");
    buf += decoder.decode(value, { stream: true });
    const nl = buf.indexOf("\n");
    if (nl < 0) continue;
    void (async () => {
      // Later lines are heartbeats; EOF means the parent is gone.
      while (!(await reader.read()).done) {}
      onEof();
    })();
    return buf.slice(0, nl).trim();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let engine: RunningEngine | undefined;
  let exiting = false;
  const shutdown = (code = 0) => {
    if (exiting) return;
    exiting = true;
    // Close the sessions Gravita runs (their claude processes) before the database.
    const stopped = engine?.stop() ?? Promise.resolve();
    stopped
      .catch((err) => stderrLogger.log("shutdown failed", err))
      .finally(() => process.exit(code));
  };
  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());

  let token: string;
  let printToken = true;
  if (args.tokenStdin) {
    token = await readStdinToken(() => shutdown());
    printToken = false;
  } else {
    token = process.env.GRAVITA_TOKEN || randomBytes(32).toString("hex");
  }
  if (!token) throw new Error("Empty token");

  engine = startEngine({ ...args, token });
  if (exiting) return;
  const ready = {
    event: "ready",
    port: engine.port,
    ...(printToken ? { token } : {}),
    pid: process.pid,
  };
  process.stdout.write(`${JSON.stringify(ready)}\n`);
}

main().catch((err) => {
  stderrLogger.log("fatal", err);
  process.exit(1);
});
