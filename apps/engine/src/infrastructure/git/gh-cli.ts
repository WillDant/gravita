import type { PullRequestHost } from "../../application/ports/git-workspace";
import type { Env } from "./git-runner";

// Pull requests through the user's own GitHub CLI: argv only (no shell), never a prompt.
// gh keeps its own login; Gravita never sees or stores the token.

export interface GhCliOptions {
  /** The gh executable (tests point it at a fake). */
  gh?: string;
  env?: Env;
  timeoutMs?: number;
}

interface GhResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class GhCli implements PullRequestHost {
  constructor(private readonly o: GhCliOptions = {}) {}

  private async gh(argv: string[], cwd?: string): Promise<GhResult> {
    try {
      const proc = Bun.spawn([this.o.gh ?? "gh", ...argv], {
        ...(cwd ? { cwd } : {}),
        env: {
          ...(this.o.env ?? process.env),
          GH_PROMPT_DISABLED: "1",
          GH_NO_UPDATE_NOTIFIER: "1",
          NO_COLOR: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: this.o.timeoutMs ?? 60_000,
        killSignal: "SIGKILL",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      return { code: await proc.exited, stdout, stderr };
    } catch (err) {
      // Not installed: spawn fails before anything runs.
      return { code: null, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
    }
  }

  async unavailable(): Promise<"not-installed" | "not-logged-in" | null> {
    if ((await this.gh(["--version"])).code !== 0) return "not-installed";
    if ((await this.gh(["auth", "status"])).code !== 0) return "not-logged-in";
    return null;
  }

  async create(p: {
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<string> {
    const r = await this.gh(
      ["pr", "create", "--base", p.base, "--head", p.head, "--title", p.title, "--body", p.body],
      p.repo,
    );
    const url = r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\//.test(l))
      .at(-1);
    if (r.code !== 0 || !url)
      throw new Error(`gh pr create failed: ${(r.stderr || r.stdout).trim().slice(-500)}`);
    return url;
  }
}
