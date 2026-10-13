import type { AgentProvider } from "@gravita/protocol/constants";
import { Check, Copy, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@/shared/i18n/i18n";
import type { ProviderProblem } from "@/shared/presenters/errors";
import { cn } from "@/shared/utils";

interface Step {
  label: string;
  command: string;
  /** Another way to do the step before it (npm instead of Homebrew): no number of its own. */
  or?: boolean;
}

/** What one provider's guidance says: its copy keys and its steps for each problem. */
interface ProviderGuide {
  /** The copy of a problem's title and body. */
  copy: (problem: ProviderProblem, part: "title" | "body") => string;
  steps: Readonly<Record<ProviderProblem, readonly Step[]>>;
}

const CLAUDE_INSTALL = "npm install -g @anthropic-ai/claude-code";
// Codex's own README offers both: a Homebrew cask and the npm package.
const CODEX_BREW = "brew install --cask codex";
const CODEX_NPM = "npm install -g @openai/codex";

/** Each provider's steps; a provider without guidance yet shows only the error line. */
const GUIDES: Readonly<Partial<Record<AgentProvider, ProviderGuide>>> = {
  claude: {
    copy: (problem, part) => `connect.${problem}.${part}`,
    steps: {
      missing: [
        { label: "connect.step.install", command: CLAUDE_INSTALL },
        { label: "connect.step.run", command: "claude" },
        { label: "connect.step.login", command: "/login" },
      ],
      outdated: [{ label: "connect.step.update", command: "claude update" }],
      loggedOut: [
        { label: "connect.step.run", command: "claude" },
        { label: "connect.step.login", command: "/login" },
      ],
    },
  },
  codex: {
    copy: (problem, part) => `connect.codex.${problem}.${part}`,
    steps: {
      missing: [
        { label: "connect.step.installBrew", command: CODEX_BREW },
        { label: "connect.step.orNpm", command: CODEX_NPM, or: true },
        { label: "connect.codex.step.run", command: "codex" },
      ],
      outdated: [
        { label: "connect.step.updateBrew", command: "brew upgrade --cask codex" },
        { label: "connect.step.orNpm", command: `${CODEX_NPM}@latest`, or: true },
      ],
      loggedOut: [{ label: "connect.codex.step.login", command: "codex login" }],
    },
  },
};

/**
 * Calm guidance when a provider's CLI is missing, outdated or logged out. Gravita never
 * logs anyone in: the steps send the user to the provider's CLI in their own Terminal.
 */
export function ConnectProvider({
  provider,
  problem,
  className,
}: {
  provider: AgentProvider;
  problem: ProviderProblem;
  className?: string;
}) {
  const guide = GUIDES[provider];
  if (!guide) return null;
  const headingId = `connect-${provider}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn("rounded-xl border border-hairline bg-panel px-4 py-3.5", className)}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 flex-none items-center justify-center rounded-lg bg-ground text-ink ring-1 ring-hairline">
          <Terminal size={15} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-sm font-semibold text-ink">
            {t(guide.copy(problem, "title"))}
          </h2>
          <p className="mt-0.5 max-w-[68ch] text-sm text-ink-2">{t(guide.copy(problem, "body"))}</p>
          <ol className="mt-3 flex flex-col gap-2">
            {numbered(guide.steps[problem]).map(({ step, n }) => (
              <li key={step.command} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-56 max-w-full text-xs text-ink-2">
                  {/* An alternative keeps the room of a number, so the commands line up. */}
                  <span className={cn("tabular-nums text-ink-3", step.or && "invisible")}>
                    {n}.
                  </span>{" "}
                  {t(step.label)}
                </span>
                <CopyCommand command={step.command} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/** Each step with its number; an alternative shares the number of the step before it. */
function numbered(steps: readonly Step[]): { step: Step; n: number }[] {
  let n = 0;
  return steps.map((step) => ({ step, n: step.or ? n : ++n }));
}

function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = () => {
    navigator.clipboard?.writeText(command).then(
      () => setCopied(true),
      () => {},
    );
  };

  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-hairline bg-ground py-0.5 pr-0.5 pl-2">
      <code className="truncate font-mono text-xs text-ink">{command}</code>
      <button
        type="button"
        onClick={copy}
        aria-label={t("connect.copy", { command })}
        className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs text-ink-3 transition-colors hover:bg-panel hover:text-ink"
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        <span aria-live="polite">{copied ? t("connect.copied") : ""}</span>
      </button>
    </span>
  );
}
