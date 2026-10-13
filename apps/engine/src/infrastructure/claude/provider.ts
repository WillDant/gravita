import type { AgentProvider } from "@gravita/protocol";

/** The provider of everything under infrastructure/claude: Claude Code's CLI, SDK and files. */
export const CLAUDE = "claude" as const satisfies AgentProvider;
