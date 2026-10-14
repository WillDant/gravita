import { isModeOf } from "@gravita/core";
import type { SessionMode, TerminalCommand, TerminalInfo } from "@gravita/protocol";
import {
  InvalidCwdError,
  InvalidSessionModeError,
  ProviderUnavailableError,
} from "../../domain/errors";
import { terminalArgv, terminalEnv } from "../../domain/terminal-command";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { ProviderTerminalFlags } from "../ports/terminal-host";
import type { Workspace } from "../ports/workspace";
import type { RuntimeFactoryRegistry } from "../services/runtime-factory-registry";
import type { TerminalManager } from "../services/terminal-manager";
import type { AnnounceProject } from "./announce-project";

export interface SpawnTerminalParams {
  cwd: string;
  command: TerminalCommand;
  cols: number;
  rows: number;
  resume?: string;
  prompt?: string;
  model?: string;
  permissionMode?: SessionMode;
}

export interface SpawnTerminalDeps {
  terminals: TerminalManager;
  workspace: Workspace;
  projects: AnnounceProject;
  /** The login shell's environment (allowlisted). */
  shellEnv: () => Promise<Record<string, string>>;
  /** The shell when the login environment names none. */
  defaultShell: string;
  /** Where the user's `claude` and `codex` are; absent in the demo (shells only). */
  providers?: RuntimeFactoryRegistry;
  flags: ProviderTerminalFlags;
  ids: IdGenerator;
  clock: Clock;
}

/**
 * Opens a terminal in a folder: the user's login shell, or their own Claude Code or Codex
 * started through it. A new Claude Code session gets its id here, so the terminal is linked
 * to its session before the session even writes its transcript.
 */
export class SpawnTerminal {
  constructor(private readonly d: SpawnTerminalDeps) {}

  async execute(p: SpawnTerminalParams): Promise<TerminalInfo> {
    if (!(await this.d.workspace.isDirectory(p.cwd))) throw new InvalidCwdError(p.cwd);
    // Sessions report their real folder (/private/tmp, not /tmp): match on that.
    const cwd = (await this.d.workspace.canonical?.(p.cwd)) ?? p.cwd;
    const provider = p.command === "shell" ? undefined : p.command;
    if (provider && p.permissionMode !== undefined && !isModeOf(provider, p.permissionMode))
      throw new InvalidSessionModeError(provider, p.permissionMode);

    const loginEnv = await this.d.shellEnv();
    const shell = loginEnv.SHELL || this.d.defaultShell;
    let cliPath: string | undefined;
    let env = loginEnv;
    if (provider) {
      if (!this.d.providers) throw new ProviderUnavailableError(provider, "not-found");
      const ready = await this.d.providers.ready(provider);
      cliPath = ready.environment.cliPath;
      env = { ...loginEnv, ...ready.environment.env };
    }
    // A new Claude Code session takes its id from here; a resumed one keeps its own.
    const sessionId = !provider
      ? undefined
      : p.resume
        ? this.d.flags.sessionIdOf(provider, p.resume)
        : provider === "claude"
          ? this.d.ids.uuid()
          : undefined;
    const argv = terminalArgv({
      command: p.command,
      shell,
      ...(cliPath ? { cliPath } : {}),
      ...(provider === "claude" && !p.resume && sessionId ? { sessionId } : {}),
      ...(provider && p.resume ? { resume: this.d.flags.resumeArg(provider, p.resume) } : {}),
      ...(p.model ? { model: p.model } : {}),
      ...(provider && p.permissionMode
        ? { modeArgs: this.d.flags.modeArgs(provider, p.permissionMode, cwd) }
        : {}),
      ...(p.prompt ? { prompt: p.prompt } : {}),
    });
    const project = await this.d.projects.execute(cwd, this.d.clock.iso());
    return this.d.terminals.spawn({
      command: p.command,
      cwd,
      projectId: project.id,
      ...(sessionId ? { sessionId } : {}),
      argv,
      env: terminalEnv(env),
      cols: p.cols,
      rows: p.rows,
    });
  }
}
