import { describe, expect, test } from "bun:test";
import * as fsp from "node:fs/promises";
import { join } from "node:path";
import type { GravitaEvent } from "@gravita/protocol";
import { mapStatus, Registry, type RegistryFs } from "../src/claude/registry";
import { Hub } from "../src/hub";
import { ProjectResolver } from "../src/projects";
import { Store } from "../src/store";
import { withTempDir } from "./helpers";

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

      const hub = new Hub(new Store(":memory:"), { demo: false });
      const seen: GravitaEvent[] = [];
      hub.listen({ events: (n) => seen.push(...n.events) });
      const fs = spyFs();
      let alive = true;
      const registry = new Registry({
        claudeHome: home,
        hub,
        projects: new ProjectResolver(hub, async () => null),
        fs,
        isAlive: (pid) => pid === 123 && alive,
      });

      await registry.scan();
      expect(registry.isLive(SID)).toBe(true);
      expect(hub.state.sessions[SID]!.presence).toBe("busy");
      expect(Object.values(hub.state.projects).map((p) => p.name)).toEqual(["demo"]);

      // Same status again: nothing new.
      await registry.scan();
      hub.flush();
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
      expect(hub.state.sessions[SID]!.presence).toBe("waiting");

      alive = false;
      await registry.scan();
      expect(registry.isLive(SID)).toBe(false);
      expect(hub.state.sessions[SID]!.live).toBe(false);
      hub.flush();
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
      expect(hub.store.maxSeq()).toBe(1);
      hub.close();
    });
  });

  test("maps registry statuses", () => {
    expect(mapStatus("busy")).toBe("busy");
    expect(mapStatus("idle")).toBe("idle");
    expect(mapStatus("waiting_for_permission")).toBe("waiting");
    expect(mapStatus(undefined)).toBe("idle");
  });
});
