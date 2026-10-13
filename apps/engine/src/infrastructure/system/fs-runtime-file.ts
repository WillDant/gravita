import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { RuntimeFile } from "@gravita/protocol/constants";
import type { RuntimeFileStore } from "../../application/ports/runtime-file";

export const RUNTIME_FILE = "runtime.json";

/**
 * `<dataDir>/runtime.json`, owner-only, replaced atomically so a hook never reads half a
 * file. Only Gravita's data dir: never anything under the Claude home.
 */
export class FsRuntimeFile implements RuntimeFileStore {
  readonly path: string;

  constructor(private readonly dataDir: string) {
    this.path = join(dataDir, RUNTIME_FILE);
  }

  write(file: RuntimeFile) {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${file.pid}.tmp`;
    try {
      // `wx`: never follow or reuse a file someone else planted at the temp path.
      rmSync(tmp, { force: true });
      writeFileSync(tmp, `${JSON.stringify(file)}\n`, { mode: 0o600, flag: "wx" });
      renameSync(tmp, this.path);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
  }

  writeIfMissing(file: RuntimeFile) {
    if (!existsSync(this.path)) this.write(file);
  }

  removeIfOwned(pid: number) {
    try {
      const current = JSON.parse(readFileSync(this.path, "utf8")) as Partial<RuntimeFile>;
      if (current.pid === pid) unlinkSync(this.path);
    } catch {
      // Missing or unreadable: nothing of ours to remove.
    }
  }
}
