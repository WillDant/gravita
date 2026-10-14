import { describe, expect, test } from "bun:test";
import { mkdir, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { codexSessionId, nodeRolloutFs, type RolloutFs } from "@gravita/adapter-codex";
import { RPC_VERSION } from "@gravita/protocol";
import {
  type CodexDiscoveryFs,
  CodexSessionDiscovery,
  nodeCodexDiscoveryFs,
} from "../../src/infrastructure/codex/codex-session-discovery";
import { CodexTranscriptReader } from "../../src/infrastructure/codex/codex-transcript-reader";
import { createCore, startEngine } from "../../src/main/container";
import { codexTails, dayDir, fixtureRollouts, installFixture } from "../codex-helpers";
import { FakeClock, SilentLogger } from "../fakes";
import { TestClient, withTempDir } from "../helpers";

// docs/COMPLIANCE.md, enforced for Codex: Gravita reads <codexHome>/sessions and nothing
// else under the Codex home (never auth.json, config.toml, the SQLite state, history.jsonl,
// archived sessions or a link out of the tree), and never writes anything there.

const SID = codexSessionId("019a2b3c-0000-7000-8000-000000000401");

/** A Codex home with real-looking secrets and state next to the sessions. */
async function codexHomeWithDecoys(home: string, nowMs: number) {
  const decoys = {
    auth: join(home, "auth.json"),
    config: join(home, "config.toml"),
    state: join(home, "state_5.sqlite"),
    history: join(home, "history.jsonl"),
    log: join(home, "log", "codex-tui.log"),
  };
  await mkdir(join(home, "log"), { recursive: true });
  await writeFile(decoys.auth, JSON.stringify({ tokens: { access_token: "must-never-be-read" } }));
  await writeFile(decoys.config, 'model = "x"\n[mcp_servers.secret]\nenv = { TOKEN = "never" }\n');
  await writeFile(decoys.state, "SQLite format 3\u0000decoy");
  await writeFile(decoys.history, `${JSON.stringify({ session_id: "x", text: "a prompt" })}\n`);
  await writeFile(decoys.log, "decoy log");
  await installFixture(home, "subagents", nowMs);
  // An archived rollout, and a link inside sessions/ that points at the credentials.
  const archived = join(home, "archived_sessions");
  await mkdir(archived, { recursive: true });
  const [old] = await fixtureRollouts("aborted-turn");
  await writeFile(join(archived, old!.name), old!.bytes);
  const today = dayDir(home, nowMs);
  await symlink(
    decoys.auth,
    join(today, "rollout-2026-10-12T00-00-00-019a2b3c-0000-7000-8000-00000000dead.jsonl"),
  );
  return { decoys, archived };
}

/** Every file under `dir` with its size and mtime, to prove nothing was written. */
async function treeState(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir, { recursive: true })) {
    const st = await stat(join(dir, name)).catch(() => null);
    out.push(`${name}:${st ? (st.isDirectory() ? "dir" : st.size) : "link"}:${st?.mtimeMs}`);
  }
  return out.sort();
}

function recording(touched: string[]): { fs: CodexDiscoveryFs; rolloutFs: RolloutFs } {
  /** Records the path, then does the real call. */
  const audit =
    <A extends unknown[], R>(fn: (path: string, ...rest: A) => R) =>
    (path: string, ...rest: A): R => {
      touched.push(path);
      return fn(path, ...rest);
    };
  return {
    fs: {
      readdir: audit(nodeCodexDiscoveryFs.readdir),
      stat: audit(nodeCodexDiscoveryFs.stat),
    },
    rolloutFs: {
      stat: audit(nodeRolloutFs.stat),
      readRange: audit(nodeRolloutFs.readRange),
      readFile: audit(nodeRolloutFs.readFile),
    },
  };
}

describe("Codex compliance", () => {
  test("observing touches only <codexHome>/sessions: never credentials, config, state or history", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      const { decoys, archived } = await codexHomeWithDecoys(home, clock.now());
      const before = await treeState(home);
      const touched: string[] = [];
      const { fs, rolloutFs } = recording(touched);

      const discovery = new CodexSessionDiscovery({
        codexHome: home,
        lookbackDays: 14,
        clock,
        fs,
        rolloutFs,
      });
      const core = createCore({
        dbPath: ":memory:",
        demo: false,
        clock,
        logger: new SilentLogger(),
        codexTranscripts: new CodexTranscriptReader({
          locate: (t) => discovery.locate(t),
          fs: rolloutFs,
        }),
      });
      const { tails } = codexTails({ codexHome: home, core, fs, rolloutFs });
      await tails.discover();
      await tails.pollHot();
      clock.advance(6 * 60_000);
      await tails.discover();
      expect(core.projection.session(SID)?.agents.main?.toolCount).toBeGreaterThan(0);
      const conv = (await core.router.dispatch("session.conversation", { sessionId: SID })) as {
        result: { messages: unknown[] };
      };
      expect(conv.result.messages.length).toBeGreaterThan(0);
      core.close();

      const sessions = join(home, "sessions");
      expect(touched.length).toBeGreaterThan(5);
      for (const p of touched) expect(p.startsWith(sessions)).toBe(true);
      for (const p of [...Object.values(decoys), archived])
        expect(touched.some((t) => t.startsWith(p))).toBe(false);
      // The link is listed but never opened or followed.
      expect(touched.some((t) => t.includes("00000000dead"))).toBe(false);
      expect(await treeState(home)).toEqual(before);
    });
  });

  test("a real engine observes a Codex home and leaves it exactly as it was", async () => {
    await withTempDir(async (root) => {
      const home = join(root, ".codex");
      await mkdir(home);
      await codexHomeWithDecoys(home, Date.now());
      const before = await treeState(home);
      const engine = startEngine({
        port: 0,
        demo: false,
        claudeHome: join(root, ".claude"),
        codexHome: home,
        lookbackDays: 14,
        dataDir: join(root, ".gravita"),
        devOrigins: ["http://localhost:5173"],
        token: "t",
        detectClaude: async () => ({ found: false }),
        detectCodex: async () => ({ found: true, path: "/opt/codex", version: "0.160.0" }),
      });
      try {
        const c = new TestClient(`ws://127.0.0.1:${engine.port}/ws`, "http://localhost:5173");
        await c.opened;
        await c.call("auth", { token: "t", rpcVersion: RPC_VERSION });
        let sessions: Record<string, { provider: string }> = {};
        for (let i = 0; i < 50 && !sessions[SID]; i++) {
          const snap = (await c.call("state.snapshot")).result as {
            state: { sessions: Record<string, { provider: string }> };
          };
          sessions = snap.state.sessions;
          if (!sessions[SID]) await Bun.sleep(100);
        }
        expect(sessions[SID]?.provider).toBe("codex");
        const status = (await c.call("engine.status")).result as {
          providers: { codex?: { found: boolean; version?: string } };
        };
        expect(status.providers.codex).toMatchObject({ found: true, version: "0.160.0" });
        const conv = (await c.call("session.conversation", { sessionId: SID })).result as {
          messages: unknown[];
        };
        expect(conv.messages.length).toBeGreaterThan(0);
        c.close();
      } finally {
        await engine.stop();
      }
      expect(await treeState(home)).toEqual(before);
      expect((await readdir(root)).sort()).toEqual([".codex", ".gravita"]);
    });
  }, 20_000);
});
