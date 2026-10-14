/** The user's folders, as far as starting a session in one is concerned. */
export interface Workspace {
  /** True when `path` is absolute and is an existing directory. */
  isDirectory(path: string): Promise<boolean>;
  /** The real path of an existing folder (symlinks resolved), as processes report it. */
  canonical?(path: string): Promise<string>;
}
