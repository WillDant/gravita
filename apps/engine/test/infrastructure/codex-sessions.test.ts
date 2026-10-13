import { describe, expect, test } from "bun:test";
import { appendFile, chmod, mkdir, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { codexSessionId } from "@gravita/adapter-codex";
import { detectCodex, MIN_CODEX_VERSION } from "../../src/infrastructure/codex/codex-detector";
import {
  CodexSessionDiscovery,
  threadCreatedMs,
} from "../../src/infrastructure/codex/codex-session-discovery";
import { CodexTranscriptReader } from "../../src/infrastructure/codex/codex-transcript-reader";
import { createCore } from "../../src/main/container";
import { codexTails, dayDir, fixtureRollouts, installFixture } from "../codex-helpers";
import { FakeClock, SilentLogger } from "../fakes";
import { withTempDir } from "../helpers";

const DAY = 86_400_000;
const id = (n: number) => `019a2b3c-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const NESTED = codexSessionId(id(0x101));
const SUBAGENTS = codexSessionId(id(0x401));

describe("Codex session discovery", () => {
  test("finds recent rollouts by date folder, groups subagents, ignores the rest", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      await installFixture(home, "subagents", clock.now());
      await installFixture(home, "nested-background", clock.now());
      // Outside the lookback: an old date folder whose file wasn't written since.
      const oldDir = await installFixture(home, "simple-edit", clock.now() - 40 * DAY);
      const old = new Date(clock.now() - 40 * DAY);
      for (const f of await fixtureRollouts("simple-edit"))
        await utimes(join(oldDir, f.name), old, old);
      // Never looked at: archived sessions, other files and links out of the tree.
      const archived = join(home, "archived_sessions");
      await mkdir(archived, { recursive: true });
      const [a] = await fixtureRollouts("aborted-turn");
      await writeFile(join(archived, a!.name), a!.bytes);
      const today = dayDir(home, clock.now());
      await writeFile(join(today, "notes.txt"), "not a rollout");
      await symlink(join(archived, a!.name), join(today, a!.name));

      const discovery = new CodexSessionDiscovery({ codexHome: home, lookbackDays: 14, clock });
      const found = await discovery.scan(() => false);
      expect(found.map((f) => f.sessionId).sort()).toEqual([NESTED, SUBAGENTS].sort());
      const sub = found.find((f) => f.sessionId === SUBAGENTS)!;
      // Two explorers; the guardian reviewer isn't part of the session.
      expect(sub.files.subagents.map((s) => s.meta.threadId)).toEqual([id(0x402), id(0x403)]);
      expect(sub.path).toEndWith(`${id(0x401)}.jsonl`);
      const nested = found.find((f) => f.sessionId === NESTED)!;
      expect(nested.files.subagents).toHaveLength(3);
      expect(nested.size).toBeGreaterThan(nested.files.root.meta.cwd!.length);

      // A known session outside the window stays fresh.
      const again = await discovery.scan((sid) => sid === codexSessionId(id(0x201)));
      expect(again.map((f) => f.sessionId)).not.toContain(codexSessionId(id(0x201)));
    });
  });

  test("older date folders are walked only every few minutes; a resumed old session is found", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      const discovery = new CodexSessionDiscovery({ codexHome: home, lookbackDays: 14, clock });
      expect(await discovery.scan(() => false)).toEqual([]);
      // A month-old session the user resumed today: its rollout lives in its old folder.
      await installFixture(home, "simple-edit", clock.now() - 30 * DAY);
      expect(await discovery.scan(() => false)).toEqual([]);
      clock.advance(5 * 60_000);
      expect((await discovery.scan(() => false)).map((f) => f.sessionId)).toEqual([
        codexSessionId(id(0x201)),
      ]);
    });
  });

  test("a subagent written today brings in its root from an older folder, found by its id", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      const files = await fixtureRollouts("subagents");
      const today = dayDir(home, clock.now());
      await mkdir(today, { recursive: true });
      // The root's v7 id dates it a year back; it lives in that day's folder.
      const created = threadCreatedMs(id(0x401))!;
      expect(clock.now() - created).toBeGreaterThan(30 * DAY);
      const discovery = new CodexSessionDiscovery({ codexHome: home, lookbackDays: 14, clock });
      // The full sweep happens on the first scan; the files arrive after it.
      expect(await discovery.scan(() => false)).toEqual([]);
      const rootDir = dayDir(home, created);
      await mkdir(rootDir, { recursive: true });
      for (const f of files) {
        const dir = f.name.includes(id(0x401)) ? rootDir : today;
        await writeFile(join(dir, f.name), f.bytes);
      }
      // Only recent folders are walked now: the root is located by the date in its id.
      clock.advance(60_000);
      const found = await discovery.scan(() => false);
      expect(found.map((f) => f.sessionId)).toEqual([SUBAGENTS]);
      expect(await discovery.locate(id(0x401))).toEndWith(`${id(0x401)}.jsonl`);
      expect(await discovery.locate(id(0x999))).toBeUndefined();
    });
  });
});

describe("Codex sessions in the tail scheduler", () => {
  test("a rollout written line by line shows up live, then detaches when it goes quiet", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      const core = createCore({
        dbPath: ":memory:",
        demo: false,
        clock,
        logger: new SilentLogger(),
      });
      const { tails, presence } = codexTails({ codexHome: home, core });
      const dir = dayDir(home, clock.now());
      await mkdir(dir, { recursive: true });
      const files = await fixtureRollouts("nested-background");
      const lines = files.map((f) => ({
        ...f,
        lines: f.bytes.toString("utf8").split("\n").filter(Boolean),
      }));
      const root = lines[0]!;
      const rootPath = join(dir, root.name);

      // Session meta, context and the prompt: the session appears, busy.
      const prompt = root.lines.findIndex((l) => l.includes("Map the auth flow"));
      await writeFile(rootPath, `${root.lines.slice(0, prompt + 1).join("\n")}\n`);
      await tails.discover();
      let s = core.projection.session(NESTED);
      expect(s?.provider).toBe("codex");
      expect(s?.cwd).toBe("/work/demo");
      expect(s?.firstUserText).toBe("Map the auth flow and plan the migration");
      expect(s?.live).toBe(true);
      expect(s?.presence).toBe("busy");
      expect(presence.isLive(NESTED)).toBe(true);
      expect(core.broadcaster.status().indexing).toEqual({ done: 1, total: 1 });

      // The rest, one line at a time, with the subagents' rollouts appearing as they start.
      for (const f of lines.slice(1)) await writeFile(join(dir, f.name), "");
      const rest = root.lines.slice(prompt + 1);
      for (const [i, line] of rest.entries()) {
        await appendFile(rootPath, `${line}\n`);
        const child = lines[1 + (i % 3)]!;
        const next = child.lines.shift();
        if (next) await appendFile(join(dir, child.name), `${next}\n`);
        await tails.discover();
        await tails.pollHot();
      }
      for (const f of lines.slice(1))
        for (const l of f.lines.splice(0)) await appendFile(join(dir, f.name), `${l}\n`);
      await tails.discover();
      await tails.pollHot();

      s = core.projection.session(NESTED)!;
      expect(Object.keys(s.agents).sort()).toEqual(
        ["main", `codex:${id(0x102)}`, `codex:${id(0x103)}`, `codex:${id(0x104)}`].sort(),
      );
      expect(s.agents[`codex:${id(0x104)}`]?.parentId).toBe(`codex:${id(0x103)}`);
      expect(s.agents.main?.lifecycle).toBe("idle");
      expect(s.presence).toBe("idle");
      expect(core.checkpoints.load(NESTED)?.path).toBe(rootPath);

      // Nothing written for longer than the idle window: detached.
      clock.advance(11 * 60_000);
      presence.tick();
      expect(core.projection.session(NESTED)?.live).toBe(false);
      expect(presence.isLive(NESTED)).toBe(false);
      core.close();
    });
  });

  test("resumes from its checkpoint after a restart without storing anything twice", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      await installFixture(home, "subagents", clock.now());
      const db = join(home, "..", `${home.split("/").at(-1)}.db`);
      const core = createCore({ dbPath: db, demo: false, clock, logger: new SilentLogger() });
      await codexTails({ codexHome: home, core }).tails.discover();
      const seq = core.events.maxSeq();
      expect(seq).toBeGreaterThan(10);
      const tools = core.projection.session(SUBAGENTS)!.agents.main!.toolCount;
      core.close();

      const again = createCore({ dbPath: db, demo: false, clock, logger: new SilentLogger() });
      await codexTails({ codexHome: home, core: again }).tails.discover();
      expect(again.events.maxSeq()).toBe(seq);
      expect(again.projection.session(SUBAGENTS)!.agents.main!.toolCount).toBe(tools);
      again.close();
      await Bun.file(db).delete();
    });
  });

  test("old plan usage from a rollout isn't taken as the account's usage now", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      await installFixture(home, "rate-limits", clock.now());
      const core = createCore({
        dbPath: ":memory:",
        demo: false,
        clock,
        logger: new SilentLogger(),
      });
      await codexTails({ codexHome: home, core }).tails.discover();
      // The fixture's readings are from 2026-10-12T14:00Z, long before "now".
      expect(core.projection.snapshot().state.usage).toEqual({});
      core.close();

      const then = new FakeClock(Date.parse("2026-10-12T14:05:00Z"));
      const fresh = createCore({
        dbPath: ":memory:",
        demo: false,
        clock: then,
        logger: new SilentLogger(),
      });
      await codexTails({ codexHome: home, core: fresh, clock: then }).tails.discover();
      expect(fresh.projection.snapshot().state.usage["codex:five_hour"]?.usedPercent).toBe(42);
      fresh.close();
    });
  });
});

describe("session.conversation on a Codex session", () => {
  test("reads the root rollout's prompts and replies; bad ids read nothing", async () => {
    await withTempDir(async (home) => {
      const clock = new FakeClock(Date.now());
      await installFixture(home, "nested-background", clock.now());
      const discovery = new CodexSessionDiscovery({ codexHome: home, lookbackDays: 14, clock });
      const core = createCore({
        dbPath: ":memory:",
        demo: false,
        clock,
        logger: new SilentLogger(),
        codexTranscripts: new CodexTranscriptReader({ locate: (t) => discovery.locate(t) }),
      });
      await codexTails({ codexHome: home, core }).tails.discover();
      const res = (await core.router.dispatch("session.conversation", { sessionId: NESTED })) as {
        result: { messages: { role: string; text: string }[] };
      };
      expect(res.result.messages.map((m) => [m.role, m.text])).toEqual([
        ["user", "Map the auth flow and plan the migration"],
        ["assistant", ""],
        ["assistant", "While that runs, I'll read the config.\n\nHere is the plan."],
      ]);
      for (const sessionId of ["codex:../../auth.json", "codex:", `codex:${id(0x999)}`])
        expect(await core.router.dispatch("session.conversation", { sessionId })).toEqual({
          result: { messages: [] },
        });
      core.close();
    });
  });
});

describe("codex cli detection", () => {
  test("finds a known path, reads its version and flags versions before the minimum", async () => {
    await withTempDir(async (dir) => {
      const bin = join(dir, "codex");
      const script = (v: string) => `#!/bin/sh\n[ "$1" = "--version" ] && echo "codex-cli ${v}"\n`;
      await writeFile(bin, script("0.159.2"));
      await chmod(bin, 0o755);
      const opts = { shell: "/usr/bin/false", knownPaths: [join(dir, "missing"), bin] };
      expect(await detectCodex(opts)).toEqual({
        found: true,
        path: bin,
        version: "0.159.2",
        outdated: true,
      });
      await writeFile(bin, script(MIN_CODEX_VERSION));
      expect(await detectCodex(opts)).toMatchObject({ found: true, outdated: false });
      expect(
        await detectCodex({ shell: "/usr/bin/false", knownPaths: [join(dir, "missing")] }),
      ).toEqual({ found: false });
    });
  });
});
