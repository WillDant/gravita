import type { PullRequestInfo } from "@gravita/protocol";
import type { PullRequestHost } from "../../application/ports/git-workspace";
import type { PullRequestLookup, PullRequestReader } from "../../application/ports/repo-reader";
import type { Env } from "./git-runner";

// Pull requests through the user's own GitHub CLI: argv only (no shell), never a prompt.
// gh keeps its own login; Gravita never sees or stores the token.

export interface GhCliOptions {
  /** The gh executable (tests point it at a fake). */
  gh?: string;
  /** A function: read for each call (e.g. the login shell's PATH, found once). */
  env?: Env | (() => Promise<Env>);
  timeoutMs?: number;
}

interface GhResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** gh couldn't start (not installed, or not on PATH). */
  missing?: true;
}

/** What `gh pr view --json` gives for the fields asked. */
interface GhPullRequest {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  reviewDecision?: string | null;
  statusCheckRollup?: { status?: string; conclusion?: string; state?: string }[] | null;
}

const FAILED = new Set([
  "FAILURE",
  "ERROR",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);
const PENDING = new Set(["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"]);

/** One word for the checks: any failure fails, else anything still running is pending. */
export function summarizeChecks(
  rollup: GhPullRequest["statusCheckRollup"],
): PullRequestInfo["checks"] {
  if (!rollup?.length) return undefined;
  let pending = false;
  for (const c of rollup) {
    const outcome = c.conclusion || c.state || "";
    if (FAILED.has(outcome)) return "failing";
    if ((c.status && c.status !== "COMPLETED") || PENDING.has(outcome)) pending = true;
  }
  return pending ? "pending" : "passing";
}

const REVIEWS: Record<string, PullRequestInfo["review"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: "review-required",
};

export function toPullRequestInfo(pr: GhPullRequest): PullRequestInfo {
  const state = pr.state.toLowerCase();
  const checks = summarizeChecks(pr.statusCheckRollup);
  const review = pr.reviewDecision ? REVIEWS[pr.reviewDecision] : undefined;
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: state === "merged" || state === "closed" ? state : "open",
    draft: pr.isDraft,
    base: pr.baseRefName,
    ...(checks ? { checks } : {}),
    ...(review ? { review } : {}),
  };
}

export class GhCli implements PullRequestHost, PullRequestReader {
  constructor(private readonly o: GhCliOptions = {}) {}

  private async gh(argv: string[], cwd?: string, timeoutMs?: number): Promise<GhResult> {
    try {
      const base = typeof this.o.env === "function" ? await this.o.env() : this.o.env;
      const proc = Bun.spawn([this.o.gh ?? "gh", ...argv], {
        ...(cwd ? { cwd } : {}),
        env: {
          ...(base ?? process.env),
          GH_PROMPT_DISABLED: "1",
          GH_NO_UPDATE_NOTIFIER: "1",
          NO_COLOR: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: timeoutMs ?? this.o.timeoutMs ?? 60_000,
        killSignal: "SIGKILL",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      return { code: await proc.exited, stdout, stderr };
    } catch (err) {
      // Not installed: spawn fails before anything runs.
      return {
        code: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        missing: true,
      };
    }
  }

  async current(repo: string): Promise<PullRequestLookup> {
    const fields = "number,title,url,state,isDraft,baseRefName,reviewDecision,statusCheckRollup";
    const r = await this.gh(["pr", "view", "--json", fields], repo, 15_000);
    if (r.missing) return { unavailable: "not-installed" };
    if (r.code !== 0) {
      const why = `${r.stderr}\n${r.stdout}`;
      if (/no (open )?pull requests? found/i.test(why)) return { pr: null };
      if (/gh auth login|not logged in|authentication/i.test(why))
        return { unavailable: "not-logged-in" };
      return { unavailable: "failed" };
    }
    try {
      return { pr: toPullRequestInfo(JSON.parse(r.stdout) as GhPullRequest) };
    } catch {
      return { unavailable: "failed" };
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
