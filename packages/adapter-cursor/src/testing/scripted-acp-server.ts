import { join } from "node:path";
import {
  loadScript,
  matches,
  ScriptedAppServer,
  type ScriptedAppServerOptions,
  type ScriptStep,
} from "@gravita/adapter-codex/testing";

// A stand-in for `cursor-agent acp` in tests: the same scripted JSON-RPC peer as Codex's
// (adapter-codex/testing), playing fixtures/cursor-acp/<version>/<scenario>.jsonl. ACP's
// `session/prompt` lasts the whole turn, so its scripts defer the answer
// (`{"expect": {...}, "defer": true}` … `{"reply": {"method": "session/prompt"}, "result": …}`).
// Nothing is answered ambiently: every request must be in the script.

export { loadScript, matches, type ScriptStep };

/** The CLI release the fixtures were modelled on. */
export const CURSOR_ACP_FIXTURE_VERSION = "2026.10.14";

/** The fixtures folder of `version`, from the repository root. */
export const cursorAcpFixtures = (version = CURSOR_ACP_FIXTURE_VERSION): string =>
  join(import.meta.dir, "../../../../fixtures/cursor-acp", version);

/** One scenario's script. */
export const cursorAcpScript = (scenario: string, version?: string): ScriptStep[] =>
  loadScript(join(cursorAcpFixtures(version), `${scenario}.jsonl`));

export class ScriptedAcpServer extends ScriptedAppServer {
  constructor(steps: readonly ScriptStep[], o: ScriptedAppServerOptions = {}) {
    super(steps, { ambient: {}, ...o });
  }
}
