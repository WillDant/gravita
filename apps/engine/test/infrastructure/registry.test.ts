import { describe, expect, test } from "bun:test";
import * as fsp from "node:fs/promises";
import { join } from "node:path";
import type { GravitaEvent } from "@gravita/protocol";
import { AnnounceProject } from "../../src/application/usecases/announce-project";
import { mapStatus, Registry, type RegistryFs } from "../../src/infrastructure/claude/registry";
import { GitProjectDirectory } from "../../src/infrastructure/system/git-project-directory";
import { createCore } from "../../src/main/container";
import { withTempDir } from "../helpers";

const SID = "22222222-2222-4222-8222-222222222222";

/** Records every path the registry reads or lists. */
function spyFs(): RegistryFs & { opened: string[]; listed: string[] } {
  const opened: string[] = [];
  const listed: string[] = [];
  return {
    opened,
    listed,
    readdir: (p) => {
      listed.push(p);
      return fsp.readdir(p);
    },
    readFile: (p, enc) => {
      opened.push(p);
      return fsp.readFile(p, enc);
    },
  };
}

describe("registry", () => {
  test("reads only <pid>.json, never *.key, and reports presence then detachment", async () => {
    await withTempDir(async (home) => {
      const dir = join(home, "sessions");
      await fsp.mkdir(dir);
      await fsp.writeFile(
        join(dir, "123.json"),
        JSON.stringify({
          pid: 123,
          sessionId: SID,
          cwd: "/nowhere/demo",
          status: "busy",
          messagingSocketPath: "/tmp/x.sock",
        }),
      );
      await fsp.writeFile(join(dir, "123.abc.key"), "must-never-be-read");
      await fsp.writeFile(join(dir, ".credentials.json"), "{}");
      await fsp.writeFile(join(dir, "123.json.bak"), "{}");

      const core = createCore({ dbPath: ":memory:", demo: false });
      const seen: GravitaEvent[] = [];
      core.broadcaster.listen({ events: (n) => seen.push(...n.events) });
      const fs = spyFs();
      let alive = true;
      const registry = new Registry({
        claudeHome: home,
        ingest: core.ingest,
        sessions: core.projection,
        projects: new AnnounceProject(
          new GitProjectDirectory(async () => null),
          core.ingest,
          core.clock,
        ),
        clock: core.clock,
        logger: core.logger,
        fs,
        isAlive: (pid) => pid === 123 && alive,
      });

      await registry.scan();
      expect(registry.isLive(SID)).toBe(true);
      expect(core.projection.session(SID)!.presence).toBe("busy");
      expect(Object.values(core.projection.snapshot().state.projects).map((p) => p.name)).toEqual([
        "demo",
      ]);

      // Same status again: nothing new.
      await registry.scan();
      core.broadcaster.flush();
      expect(seen.filter((e) => e.type === "session.presence")).toHaveLength(1);

      await fsp.writeFile(
        join(dir, "123.json"),
        JSON.stringify({
          pid: 123,
          sessionId: SID,
          cwd: "/nowhere/demo",
          status: "waiting_for_input",
        }),
      );
      await registry.scan();
      expect(core.projection.session(SID)!.presence).toBe("waiting");

      alive = false;
      await registry.scan();
      expect(registry.isLive(SID)).toBe(false);
      expect(core.projection.session(SID)!.live).toBe(false);
      core.broadcaster.flush();
      expect(seen.map((e) => e.type)).toEqual([
        "project.discovered",
        "session.presence",
        "session.presence",
        "session.detached",
      ]);

      expect(fs.opened.length).toBeGreaterThan(0);
      expect(fs.opened.every((p) => /\/\d+\.json$/.test(p))).toBe(true);
      expect(fs.opened.some((p) => p.endsWith(".key") || p.includes("credentials"))).toBe(false);
      expect(fs.listed.every((p) => p === dir)).toBe(true);
      // Presence and detachment are ephemeral; only the project was stored.
      expect(core.events.maxSeq()).toBe(1);
      core.close();
    });
  });

  test("maps registry statuses", () => {
    expect(mapStatus("busy")).toBe("busy");
    expect(mapStatus("idle")).toBe("idle");
    expect(mapStatus("waiting_for_permission")).toBe("waiting");
    expect(mapStatus(undefined)).toBe("idle");
  });
});
