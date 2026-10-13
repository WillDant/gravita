import { createHash } from "node:crypto";
import { stableJson } from "./tools";

// Apart from `./tools` because it hashes with node:crypto: the engine and the adapters use
// it, the UI bundle never imports it.

/** Equal for the same tool and input (key order aside): ties a permission prompt to its call. */
export function inputKeyOf(toolName: string, input: Record<string, unknown>): string {
  return createHash("sha1")
    .update(`${toolName}\0${stableJson(input)}`)
    .digest("hex")
    .slice(0, 16);
}
