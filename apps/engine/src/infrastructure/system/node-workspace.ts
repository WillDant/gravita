import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { Workspace } from "../../application/ports/workspace";

export class NodeWorkspace implements Workspace {
  async isDirectory(path: string): Promise<boolean> {
    if (!isAbsolute(path)) return false;
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  }
}
