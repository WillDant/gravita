/** The user's folders, as far as starting a session in one is concerned. */
export interface Workspace {
  /** True when `path` is absolute and is an existing directory. */
  isDirectory(path: string): Promise<boolean>;
}
