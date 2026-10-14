import type { AgentProvider } from "@gravita/protocol";

/** The provider of everything under infrastructure/cursor: the `cursor-agent` CLI over ACP. */
export const CURSOR = "cursor" as const satisfies AgentProvider;
