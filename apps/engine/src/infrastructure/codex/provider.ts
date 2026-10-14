import type { AgentProvider } from "@gravita/protocol";

/** The provider of everything under infrastructure/codex: Codex's CLI and rollout files. */
export const CODEX = "codex" as const satisfies AgentProvider;
