import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { startScenario } from "@gravita/adapter-fake";
import { keys } from "@gravita/protocol";
import pkg from "../package.json" with { type: "json" };
import type { EngineArgs } from "./args";
import { detectClaude } from "./claude/cli";
import { ClaudeIngest } from "./claude/ingest";
import { Registry } from "./claude/registry";
import { Hub } from "./hub";
import { log } from "./log";
import { ProjectResolver } from "./projects";
import { startServer } from "./server";
import { Store } from "./store";

export const ENGINE_VERSION: string = pkg.version;

export interface EngineOptions extends Omit<EngineArgs, "tokenStdin"> {
  token: string;
  /** Seed of the demo story. */
  demoSeed?: number;
}

export interface RunningEngine {
  port: number;
  hub: Hub;
  stop(): void;
}

/**
 * Wires store → hub → server and the sources. Demo mode plays the scripted provider
 * into an in-memory database and never touches claudeHome or dataDir.
 */
export function startEngine(opts: EngineOptions): RunningEngine {
  let dbPath = ":memory:";
  if (!opts.demo) {
    mkdirSync(opts.dataDir, { recursive: true, mode: 0o700 });
    dbPath = join(opts.dataDir, "gravita.db");
  }
  const store = new Store(dbPath);
  // Previews of transcripts live here: owner-only.
  if (!opts.demo) chmodSync(dbPath, 0o600);
  const hub = new Hub(store, { demo: opts.demo });
  const stops: (() => void)[] = [];

  let server: ReturnType<typeof startServer>;
  try {
    server = startServer(hub, {
      port: opts.port,
      token: opts.token,
      devOrigins: opts.devOrigins,
      engineVersion: ENGINE_VERSION,
    });
  } catch (err) {
    store.close();
    throw err;
  }

  if (opts.demo) {
    stops.push(startScenario({ seed: opts.demoSeed ?? 1 }, (e) => hub.ingest([e])));
    // Demo sessions behave like ones Gravita runs: the user can answer their prompts.
    // The scripted auto-answer later carries the same key, so the user's answer wins.
    hub.permissionResponder = (p) => {
      const session = hub.state.sessions[p.sessionId];
      const agent = session?.agents[p.agentId];
      if (!session || !agent?.pendingPermissions.includes(p.requestId)) return false;
      hub.ingest([
        {
          key: keys.permissionResolved(p.requestId),
          ts: new Date().toISOString(),
          source: "gravita",
          provider: "claude",
          projectId: session.projectId,
          sessionId: p.sessionId,
          agentId: p.agentId,
          type: "permission.resolved",
          data: { requestId: p.requestId, decision: p.decision, by: "user" },
        },
      ]);
      return true;
    };
  } else {
    const projects = new ProjectResolver(hub);
    const registry = new Registry({ claudeHome: opts.claudeHome, hub, projects });
    const ingest = new ClaudeIngest({
      claudeHome: opts.claudeHome,
      lookbackDays: opts.lookbackDays,
      hub,
      projects,
      isLive: registry.isLive,
    });
    registry.start();
    ingest.start();
    stops.push(
      () => registry.stop(),
      () => ingest.stop(),
    );
    detectClaude()
      .then((claude) => hub.updateStatus({ claude }))
      .catch((err) => log("claude detection failed", err));
  }

  let stopped = false;
  return {
    port: server.port,
    hub,
    stop() {
      if (stopped) return;
      stopped = true;
      for (const stop of stops) stop();
      server.stop();
      hub.close();
      store.close();
    },
  };
}
