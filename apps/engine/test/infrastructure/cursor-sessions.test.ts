import { describe, expect, test } from "bun:test";
import { appendFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { cursorSessionId } from "@gravita/adapter-cursor";
import {
  CursorSessionDiscovery,
  nodeCursorDiscoveryFs,
} from "../../src/infrastructure/cursor/cursor-session-discovery";
import { createCore } from "../../src/main/container";
import {
  CHILD_CHAT,
  cursorTails,
  installCursorFixture,
  ROOT_CHAT,
} from "../cursor-transcript-helpers";
import { FakeClock, SilentLogger } from "../fakes";
import { withTempDir } from "../helpers";

const SESSION = cursorSessionId(ROOT_CHAT);
const agentDir = (home: string) => join(home, "projects/work-demo/agent-transcripts");

function newCore(clock: FakeClock) {
  return createCore({ dbPath: ":memory:", demo: false, clock, logger: new SilentLogger() });
}

describe("CursorSessionDiscovery", () => {
  test("a chat and its subagent are one session, found once its start is certain", async () => {
    await withTempDir(async (home) => {
      await installCursorFixture(home, "subagents");
      const clock = new FakeClock(Date.now());
      const discovery = new CursorSessionDiscovery({ cursorHome: home, lookbackDays: 14, clock });

      // A transcript might still turn out to be someone's subagent: it waits a moment.
      expect(await discovery.scan(() => false)).toEqual([]);
      clock.advance(3_000);
      const found = await discovery.scan(() => false);
      expect(found.map((f) => f.sessionId)).toEqual([SESSION]);
      expect(found[0]?.meta).toMatchObject({ cwd: "/work/demo", title: "File Read And Create" });
      expect(found[0]?.children).toEqual([
        {
          path: join(agentDir(home), CHILD_CHAT, `${CHILD_CHAT}.jsonl`),
          chatId: CHILD_CHAT,
          parentChatId: ROOT_CHAT,
        },
      ]);
    });
  });

  test("leaves alone what is not a terminal chat: no meta, symlinks, other files", async () => {
    await withTempDir(async (home) => {
      await installCursorFixture(home, "subagents");
      const editor = join(agentDir(home), "editor-chat");
      await mkdir(editor, { recursive: true });
      await writeFile(
        join(editor, "editor-chat.jsonl"),
        `${JSON.stringify({ role: "user", message: { content: [{ type: "text", text: "<user_query>\nhi\n</user_query>" }] } })}\n`,
      );
      const real = join(agentDir(home), ROOT_CHAT, `${ROOT_CHAT}.jsonl`);
      const linked = join(agentDir(home), "linked");
      await mkdir(linked);
      await symlink(real, join(linked, "linked.jsonl"));
      await writeFile(join(home, "auth.json"), "{}");

      const clock = new FakeClock(Date.now());
      const discovery = new CursorSessionDiscovery({ cursorHome: home, lookbackDays: 14, clock });
      await discovery.scan(() => false);
      clock.advance(3_000);
      expect((await discovery.scan(() => false)).map((f) => f.sessionId)).toEqual([SESSION]);
    });
  });

  test("touches only transcripts and chat metadata under the Cursor home", async () => {
    await withTempDir(async (home) => {
      await installCursorFixture(home, "subagents");
      for (const decoy of ["auth.json", "cli-config.json", "mcp-auth.json"])
        await writeFile(join(home, decoy), "secret");
      await mkdir(join(home, "acp-sessions/x"), { recursive: true });
      await writeFile(join(home, "acp-sessions/x/store.db"), "db");

      const touched = new Set<string>();
      const seen = (p: string) => touched.add(relative(home, p));
      const rolloutFs = {
        stat: async (p: string) => {
          seen(p);
          return (await import("node:fs/promises")).stat(p);
        },
        readRange: async (p: string, pos: number, len: number) => {
          seen(p);
          const { nodeRolloutFs } = await import("@gravita/adapter-codex");
          return nodeRolloutFs.readRange(p, pos, len);
        },
        readFile: async (p: string) => {
          seen(p);
          const { nodeRolloutFs } = await import("@gravita/adapter-codex");
          return nodeRolloutFs.readFile(p);
        },
      };
      const clock = new FakeClock(Date.now());
      const discovery = new CursorSessionDiscovery({
        cursorHome: home,
        lookbackDays: 14,
        clock,
        rolloutFs,
        fs: {
          readdir: (p) => {
            seen(p);
            return nodeCursorDiscoveryFs.readdir(p);
          },
          stat: (p) => {
            seen(p);
            return nodeCursorDiscoveryFs.stat(p);
          },
        },
      });
      await discovery.scan(() => false);
      clock.advance(3_000);
      await discovery.scan(() => false);

      const allowed = [
        /^projects$/,
        /^projects\/[^/]+$/,
        /^projects\/[^/]+\/agent-transcripts(\/[^/]+(\/subagents)?)?$/,
        /^projects\/[^/]+\/agent-transcripts\/[^/]+\/(subagents\/)?[^/]+\.jsonl$/,
        /^chats$/,
        /^chats\/[^/]+$/,
        /^chats\/[^/]+\/[^/]+\/meta\.json$/,
      ];
      for (const p of touched)
        expect(
          allowed.some((r) => r.test(p)),
          p,
        ).toBe(true);
      for (const p of touched) expect(p).not.toMatch(/auth|config|acp-sessions|store\.db/);
    });
  });
});

describe("Cursor chats in the tail scheduler", () => {
  test("a chat becomes a session with its subagent, live, then detaches when quiet", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      const core = newCore(clock);
      await installCursorFixture(home, "subagents");
      const { tails, presence } = cursorTails({ cursorHome: home, core });

      await tails.discover();
      clock.advance(3_000);
      await tails.discover();
      await tails.pollHot();

      const s = core.projection.session(SESSION);
      expect(s?.provider).toBe("cursor");
      expect(s?.cwd).toBe("/work/demo");
      expect(s?.firstUserText).toContain("hello.txt");
      expect(Object.keys(s?.agents ?? {}).sort()).toEqual(
        ["main", cursorSessionId(CHILD_CHAT)].sort(),
      );
      expect(s?.agents[cursorSessionId(CHILD_CHAT)]?.parentId).toBe("main");
      // The subagent is not a session of its own.
      expect(core.projection.session(cursorSessionId(CHILD_CHAT))).toBeUndefined();
      expect(core.checkpoints.load(SESSION)).toBeDefined();

      clock.advance(11 * 60_000);
      presence.tick();
      expect(core.projection.session(SESSION)?.live).toBe(false);
      core.close();
    });
  });

  test("a chat written while it is read: busy while the turn is open, idle after", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      const core = newCore(clock);
      await installCursorFixture(home, "subagents");
      const root = join(agentDir(home), ROOT_CHAT, `${ROOT_CHAT}.jsonl`);
      const lines = (await Bun.file(root).text()).split("\n").filter(Boolean);
      await writeFile(root, `${lines[0]}\n`);
      const { tails, presence } = cursorTails({ cursorHome: home, core });

      await tails.discover();
      clock.advance(3_000);
      await tails.discover();
      await tails.pollHot();
      expect(core.projection.session(SESSION)?.presence).toBe("busy");
      expect(presence.isLive(SESSION)).toBe(true);

      for (const l of lines.slice(1)) await appendFile(root, `${l}\n`);
      await tails.pollHot();
      expect(core.projection.session(SESSION)?.presence).toBe("idle");
      core.close();
    });
  });

  test("resumes from its checkpoint after a restart without storing anything twice", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      const core = newCore(clock);
      await installCursorFixture(home, "subagents");
      const first = cursorTails({ cursorHome: home, core });
      await first.tails.discover();
      clock.advance(3_000);
      await first.tails.discover();
      await first.tails.pollHot();
      const seq = core.events.maxSeq();

      const second = cursorTails({ cursorHome: home, core });
      await second.tails.discover();
      await second.tails.pollHot();
      expect(core.events.maxSeq()).toBe(seq);
      core.close();
    });
  });
});
