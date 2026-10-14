import type { UsageLimitState } from "@gravita/core";

/** The latest plan usage readings in the live projection (copies), by provider and window. */
export interface UsageReader {
  usage(): Record<string, UsageLimitState>;
}
