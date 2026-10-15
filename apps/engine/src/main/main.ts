import { randomBytes } from "node:crypto";
import { MemoryCredentialSource } from "../infrastructure/credentials/memory-credential-source";
import { GithubReleaseSource } from "../infrastructure/releases/github-release-source";
import { parseArgs } from "./args";
import { ENGINE_VERSION, type RunningEngine, startEngine, stderrLogger } from "./container";
import { readStdinBootstrap } from "./stdin-bootstrap";

// gravita-engine: the local sidecar. Prints exactly one JSON line on stdout when ready:
// {"event":"ready","port":<n>,"token":"<hex>","pid":<pid>} (token omitted with --token-stdin).
// With --token-stdin, the desktop shell also hands over the Cursor API key on stdin (never
// argv, never the environment): see stdin-bootstrap.ts.

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

  const credentials = new MemoryCredentialSource();
  let token: string;
  let printToken = true;
  if (args.tokenStdin) {
    token = await readStdinBootstrap(Bun.stdin.stream(), credentials, () => shutdown());
    printToken = false;
  } else {
    token = process.env.GRAVITA_TOKEN || randomBytes(32).toString("hex");
  }
  if (!token) throw new Error("Empty token");

  // Real runs look for a newer release (public GitHub, anonymous); tests start the engine without.
  engine = startEngine({
    ...args,
    token,
    credentials,
    releaseSource: new GithubReleaseSource(ENGINE_VERSION),
  });
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
