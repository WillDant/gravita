import type { CredentialSource } from "../../application/ports/credential-source";
import type { ModelOption } from "../../application/ports/session-runtime";
import type { AgentEnvironmentSource } from "../providers/agent-environment";
import {
  type RunWithEnv,
  VALIDATE_TIMEOUT_MS,
  runWithEnv as defaultRun,
} from "./cursor-key-validator";
import { cursorChatEnv } from "./cursor-environment";
import { parseCursorModelsOutput } from "./cursor-models-parser";

/** Models the account's key can use, read from `cursor-agent models` (before any chat runs). */
export async function cursorModelsCatalog(
  environment: AgentEnvironmentSource,
  credentials: CredentialSource,
  run: RunWithEnv = defaultRun,
): Promise<ModelOption[]> {
  const key = credentials.cursorKey();
  if (!key) return [];
  try {
    const cli = await environment.load();
    const r = await run(
      [cli.cliPath, "models"],
      cursorChatEnv(cli.env, key),
      VALIDATE_TIMEOUT_MS,
    );
    if (r.code !== 0) return [];
    return parseCursorModelsOutput(r.output);
  } catch {
    return [];
  }
}
