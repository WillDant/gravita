import type { TerminalCommand } from "@gravita/protocol";

// What an embedded terminal runs. The user's own CLI goes through their login shell
// (`-l -i`), so it sees exactly the environment it gets in their own terminal: profile
// exports, version managers, the variables their MCP servers read. Nothing of Gravita's
// is added (no GRAVITA_MANAGED: Deep Observe hooks must report these sessions). Cursor's
// terminal is the one exception to "the user's environment": see `cursorTerminalEnv`.

export const MAX_TERMINALS = 8;

export interface TerminalLaunch {
  command: TerminalCommand;
  /** The user's login shell (absolute path). */
  shell: string;
  /** The provider's CLI; required unless `command` is `shell`. */
  cliPath?: string;
  /** Claude Code: the id a new session takes, so the terminal knows its session from the start. */
  sessionId?: string;
  /** Resume this session instead of starting one. */
  resume?: string;
  model?: string;
  /** The provider's flags for the chosen mode, already in its terms. */
  modeArgs?: readonly string[];
  /** The first message. */
  prompt?: string;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

/** The prompt as the last argument; `--` first when it would read as an option. */
function promptArgs(prompt: string | undefined): string[] {
  if (!prompt) return [];
  return prompt.startsWith("-") ? ["--", prompt] : [prompt];
}

function claudeArgs(l: TerminalLaunch): string[] {
  return [
    ...(l.resume ? ["--resume", l.resume] : l.sessionId ? ["--session-id", l.sessionId] : []),
    ...(l.model ? ["--model", l.model] : []),
    ...(l.modeArgs ?? []),
    ...promptArgs(l.prompt),
  ];
}

function codexArgs(l: TerminalLaunch): string[] {
  return [
    ...(l.resume ? ["resume"] : []),
    ...(l.model ? ["-m", l.model] : []),
    ...(l.modeArgs ?? []),
    ...(l.resume ? [l.resume] : []),
    ...promptArgs(l.prompt),
  ];
}

function cursorArgs(l: TerminalLaunch): string[] {
  return [
    ...(l.resume ? ["--resume", l.resume] : []),
    ...(l.model ? ["--model", l.model] : []),
    ...(l.modeArgs ?? []),
    ...promptArgs(l.prompt),
  ];
}

const ARGS_OF: Record<Exclude<TerminalCommand, "shell">, (l: TerminalLaunch) => string[]> = {
  claude: claudeArgs,
  codex: codexArgs,
  cursor: cursorArgs,
};

/** The argv a terminal's process starts with. */
export function terminalArgv(l: TerminalLaunch): string[] {
  if (l.command === "shell") return [l.shell, "-l"];
  if (!l.cliPath) throw new Error(`${l.command} needs its CLI path`);
  const cli = [l.cliPath, ...ARGS_OF[l.command](l)];
  // `-c script name args…` makes args the script's "$@" (fish: $argv, without the name).
  return basename(l.shell) === "fish"
    ? [l.shell, "-lic", "exec $argv", ...cli]
    : [l.shell, "-lic", 'exec "$@"', "gravita-terminal", ...cli];
}

/**
 * The variables a terminal starts with: the captured login environment (allowlisted, so
 * nothing host-scoped leaks in), and the terminal's own type. The login shell then
 * rebuilds the rest from the user's profile.
 */
export function terminalEnv(loginEnv: Record<string, string>): Record<string, string> {
  return { ...loginEnv, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Gravita" };
}
