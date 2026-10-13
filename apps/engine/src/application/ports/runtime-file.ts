import type { RuntimeFile } from "@gravita/protocol/constants";

/** Where Deep Observe hooks find the running engine (port and hook token). */
export interface RuntimeFileStore {
  write(file: RuntimeFile): void;
  /** Writes it only when there is none, e.g. after a demo engine removed its own on exit. */
  writeIfMissing(file: RuntimeFile): void;
  /** Removes the file, unless another engine (another pid) has written it since. */
  removeIfOwned(pid: number): void;
}
