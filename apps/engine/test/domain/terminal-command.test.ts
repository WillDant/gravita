import { describe, expect, test } from "bun:test";
import { terminalArgv, terminalEnv } from "../../src/domain/terminal-command";

const zsh = "/bin/zsh";

describe("terminalArgv", () => {
  test("a shell is the user's login shell", () => {
    expect(terminalArgv({ command: "shell", shell: zsh })).toEqual([zsh, "-l"]);
  });

  test("Claude Code runs through the login shell with its session id, model, mode and prompt", () => {
    expect(
      terminalArgv({
        command: "claude",
        shell: zsh,
        cliPath: "/opt/claude",
        sessionId: "abc",
        model: "opus",
        modeArgs: ["--permission-mode", "plan"],
        prompt: "Fix the login",
      }),
    ).toEqual([
      zsh,
      "-lic",
      'exec "$@"',
      "gravita-terminal",
      "/opt/claude",
      "--session-id",
      "abc",
      "--model",
      "opus",
      "--permission-mode",
      "plan",
      "Fix the login",
    ]);
  });

  test("a resumed session resumes instead of taking a new id", () => {
    expect(
      terminalArgv({
        command: "claude",
        shell: zsh,
        cliPath: "/opt/claude",
        sessionId: "new",
        resume: "old",
      }).slice(4),
    ).toEqual(["/opt/claude", "--resume", "old"]);
  });

  test("Codex resumes with its subcommand, options before the id", () => {
    expect(
      terminalArgv({
        command: "codex",
        shell: zsh,
        cliPath: "/opt/codex",
        resume: "t-1",
        model: "gpt-5",
        modeArgs: ["-a", "on-request", "-s", "read-only"],
      }).slice(4),
    ).toEqual([
      "/opt/codex",
      "resume",
      "-m",
      "gpt-5",
      "-a",
      "on-request",
      "-s",
      "read-only",
      "t-1",
    ]);
  });

  test("Cursor resumes with --resume and takes model, mode and prompt", () => {
    expect(
      terminalArgv({
        command: "cursor",
        shell: zsh,
        cliPath: "/opt/cursor-agent",
        resume: "c-1",
        model: "gpt-5.5",
        modeArgs: ["--mode", "ask"],
        prompt: "why",
      }).slice(4),
    ).toEqual([
      "/opt/cursor-agent",
      "--resume",
      "c-1",
      "--model",
      "gpt-5.5",
      "--mode",
      "ask",
      "why",
    ]);
  });

  test("a prompt that looks like an option comes after --", () => {
    expect(
      terminalArgv({ command: "codex", shell: zsh, cliPath: "/opt/codex", prompt: "-h me" }).slice(
        4,
      ),
    ).toEqual(["/opt/codex", "--", "-h me"]);
  });

  test("fish takes the arguments as $argv", () => {
    expect(
      terminalArgv({ command: "claude", shell: "/usr/local/bin/fish", cliPath: "/opt/claude" }),
    ).toEqual(["/usr/local/bin/fish", "-lic", "exec $argv", "/opt/claude"]);
  });
});

describe("terminalEnv", () => {
  test("adds the terminal's type and nothing that marks the session as Gravita's", () => {
    const env = terminalEnv({ PATH: "/usr/bin", HOME: "/home/u" });
    expect(env).toMatchObject({ PATH: "/usr/bin", TERM: "xterm-256color", COLORTERM: "truecolor" });
    expect(env.GRAVITA_MANAGED).toBeUndefined();
  });
});
