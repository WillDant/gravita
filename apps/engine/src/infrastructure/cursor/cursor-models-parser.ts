import type { ModelOption } from "../../application/ports/session-runtime";

/** Lines like `auto - Auto (current, default)` from `cursor-agent models`. */
const LINE = /^(\S+)\s+-\s+(.+)$/;

/** Turns `cursor-agent models` stdout into picker options (`auto` → Gravita's `default`). */
export function parseCursorModelsOutput(output: string): ModelOption[] {
  const models: ModelOption[] = [];
  const seen = new Set<string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "Available models") continue;
    const m = LINE.exec(trimmed);
    if (!m) continue;
    const [, cliId, rawName] = m;
    if (!cliId || !rawName) continue;
    const displayName = rawName
      .replace(/\s*\(current,\s*default\)\s*$/i, "")
      .replace(/\s*\(NO ZDR\)\s*$/i, "")
      .trim();
    const value = cliId === "auto" ? "default" : cliId;
    if (seen.has(value)) continue;
    seen.add(value);
    models.push({ value, displayName: displayName || cliId });
  }
  return models;
}
