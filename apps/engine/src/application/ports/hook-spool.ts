/** Hooks the plugin wrote to disk while the engine wasn't reachable. */
export interface HookSpool {
  /**
   * Takes everything spooled so far and hands each payload to `each`, in order (malformed
   * lines are skipped). Returns how many payloads were handed over.
   */
  drain(each: (payload: unknown) => Promise<void>): Promise<number>;
}
