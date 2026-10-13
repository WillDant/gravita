import type { ProjectIdentity } from "@gravita/protocol";

/** Maps a working directory to the project it belongs to (e.g. its git repository). */
export interface ProjectDirectory {
  resolve(cwd: string): Promise<ProjectIdentity>;
}
