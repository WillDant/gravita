import type { GitFileChange, GitInfo, PullRequestInfo } from "@gravita/protocol";
import { ChevronRight, ExternalLink, GitBranch, GitPullRequest, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { t, useLocale } from "@/shared/i18n/i18n";
import { CopyButton } from "@/shared/ui/CopyButton";
import { cn } from "@/shared/utils";
import { type FileDiff, parseDiff } from "./diff";
import { useGitInfo } from "./useGitInfo";

// The session's repository at a glance: a button in the session header (its branch and how
// many files changed) opens a side panel with the branch, its pull request and the diff.

const SUMMARY_POLL_MS = 10_000;
const PANEL_POLL_MS = 15_000;
/** Below this many diff lines, every file opens expanded. */
const EXPAND_ALL_LINES = 400;

const isToggleKey = (e: KeyboardEvent) =>
  (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "g";

/** The header button: the branch and a count of changed files; ⇧⌘G toggles the panel too. */
export function GitButton({ cwd }: { cwd: string }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const { info } = useGitInfo(cwd, { enabled: true, summary: true, pollMs: SUMMARY_POLL_MS });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isToggleKey(e)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Not a repository (or not read yet): nothing to open.
  if (!info?.repo) return null;
  const changed = info.files.length;
  const branch = info.branch ?? t("git.detached");
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("git.open", { branch, count: changed })}
        title={`${t("git.title")} (⇧⌘G)`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-ink-2 transition-colors hover:bg-panel hover:text-ink",
          open && "bg-panel text-ink",
        )}
      >
        <GitBranch size={15} aria-hidden="true" className="flex-none" />
        <span className="truncate font-mono">{branch}</span>
        {changed > 0 && (
          <span className="flex-none rounded-full bg-panel-2 px-1.5 text-[11px] font-bold tabular-nums text-ink">
            {changed}
          </span>
        )}
      </button>
      {open && <GitPanel cwd={cwd} onClose={() => setOpen(false)} />}
    </>
  );
}

export function GitPanel({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  useLocale();
  const titleId = useId();
  const { info, loading, error, refresh } = useGitInfo(cwd, {
    enabled: true,
    pollMs: PANEL_POLL_MS,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Pressing outside closes; the keyboard has Escape, so it skips the tab order. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onMouseDown={onClose}
        className="absolute inset-0 cursor-default bg-scrim"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-[min(760px,94vw)] flex-col border-l border-hairline bg-ground shadow-float"
      >
        <header className="flex flex-none items-center gap-2 border-b border-hairline px-5 py-3">
          <GitBranch size={16} aria-hidden="true" className="text-ink-2" />
          <h2 id={titleId} className="text-sm font-semibold text-ink">
            {t("git.title")}
          </h2>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">
            {info?.repo ? info.root : cwd}
          </span>
          <button
            type="button"
            aria-label={t("git.refresh")}
            title={t("git.refresh")}
            aria-busy={loading}
            onClick={refresh}
            className="inline-flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-panel hover:text-ink"
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={cn(loading && "motion-safe:animate-spin")}
            />
          </button>
          <button
            type="button"
            aria-label={t("git.close")}
            title={t("git.close")}
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-panel hover:text-ink"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <p role="alert" className="px-5 pt-4 text-sm text-error-ink">
              {error}
            </p>
          )}
          {!info ? (
            !error && (
              <p role="status" className="px-5 py-4 text-sm text-ink-2">
                {t("git.loading")}
              </p>
            )
          ) : !info.repo ? (
            <p className="px-5 py-4 text-sm text-ink-2">{t("git.notRepo")}</p>
          ) : (
            <RepoView info={info} />
          )}
        </div>
      </aside>
    </div>
  );
}

function RepoView({ info }: { info: Extract<GitInfo, { repo: true }> }) {
  return (
    <>
      <section className="flex flex-col gap-1.5 border-b border-hairline px-5 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm font-medium text-ink">
            {info.branch ?? t("git.detached")}
          </span>
          {info.branch && <CopyButton text={info.branch} label={t("git.copyBranch")} />}
          {info.head && (
            <span className="ml-auto flex-none font-mono text-xs text-ink-3">{info.head}</span>
          )}
        </div>
        <p className="text-xs text-ink-2">
          {info.upstream ? (
            <>
              <span className="font-mono">{info.upstream}</span>
              {" · "}
              {info.ahead === 0 && info.behind === 0
                ? t("git.upToDate")
                : [
                    info.ahead > 0 && t("git.ahead", { count: info.ahead }),
                    info.behind > 0 && t("git.behind", { count: info.behind }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </>
          ) : (
            t("git.noUpstream")
          )}
        </p>
      </section>
      <PullRequestSection info={info} />
      <Changes info={info} />
    </>
  );
}

function PullRequestSection({ info }: { info: Extract<GitInfo, { repo: true }> }) {
  const { pr } = info;
  if (!info.branch && !pr) return null;
  return (
    <section className="border-b border-hairline px-5 py-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-3">
        <GitPullRequest size={13} aria-hidden="true" />
        {t("git.pr")}
      </h3>
      {pr ? (
        <PullRequestCard pr={pr} />
      ) : (
        <p className="text-sm text-ink-2">
          {t(info.prUnavailable ? `git.pr.${info.prUnavailable}` : "git.pr.none")}
        </p>
      )}
    </section>
  );
}

const PR_DOT: Record<PullRequestInfo["state"] | "draft", string> = {
  open: "bg-ok",
  draft: "border border-ink-3",
  merged: "bg-ink",
  closed: "bg-ink-3",
};
const CHECK_DOT: Record<NonNullable<PullRequestInfo["checks"]>, string> = {
  passing: "bg-ok",
  failing: "bg-error",
  pending: "bg-waiting",
};

function PullRequestCard({ pr }: { pr: PullRequestInfo }) {
  const state = pr.state === "open" && pr.draft ? "draft" : pr.state;
  return (
    <div className="flex flex-col gap-2">
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="group inline-flex min-w-0 items-baseline gap-1.5 text-sm font-semibold text-ink hover:underline"
      >
        <span className="flex-none tabular-nums text-ink-3">#{pr.number}</span>
        <span className="min-w-0">{pr.title}</span>
        <ExternalLink
          size={12}
          aria-hidden="true"
          className="flex-none self-center text-ink-3 group-hover:text-ink"
        />
      </a>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
        <Dot className={PR_DOT[state]} label={t(`git.pr.state.${state}`)} />
        <span>
          {t("git.pr.into")} <span className="font-mono">{pr.base}</span>
        </span>
        {pr.checks && (
          <Dot className={CHECK_DOT[pr.checks]} label={t(`git.pr.checks.${pr.checks}`)} />
        )}
        {pr.review && <span>{t(`git.pr.review.${pr.review}`)}</span>}
      </div>
    </div>
  );
}

function Dot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <span className={cn("size-2 flex-none rounded-full", className)} aria-hidden="true" />
      {label}
    </span>
  );
}

const STATE_LETTER: Record<GitFileChange["state"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  conflicted: "!",
};

function Changes({ info }: { info: Extract<GitInfo, { repo: true }> }) {
  const diffs = useMemo(() => {
    const byPath = new Map<string, FileDiff>();
    for (const d of parseDiff(info.diff)) byPath.set(d.path, d);
    return byPath;
  }, [info.diff]);
  const totalLines = useMemo(
    () => [...diffs.values()].reduce((n, d) => n + d.lines.length, 0),
    [diffs],
  );
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const expandAll = totalLines <= EXPAND_ALL_LINES;
  const isOpen = (path: string) => expandAll !== toggled.has(path);
  const toggle = (path: string) =>
    setToggled((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const additions = [...diffs.values()].reduce((n, d) => n + d.additions, 0);
  const deletions = [...diffs.values()].reduce((n, d) => n + d.deletions, 0);

  return (
    <section className="px-5 py-4">
      <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-3">
        {t("git.changes", { count: info.files.length })}
        {info.files.length > 0 && (
          <span className="font-mono font-medium tabular-nums">
            <span className="text-ok-ink">+{additions}</span>{" "}
            <span className="text-error-ink">−{deletions}</span>
          </span>
        )}
      </h3>
      {info.files.length === 0 ? (
        <p className="text-sm text-ink-2">{t("git.clean")}</p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-xl border border-hairline">
          {info.files.map((f) => (
            <FileRow
              key={`${f.state}:${f.path}`}
              file={f}
              diff={diffs.get(f.path)}
              open={isOpen(f.path)}
              onToggle={() => toggle(f.path)}
            />
          ))}
        </ul>
      )}
      {info.diffTruncated && <p className="mt-3 text-xs text-ink-3">{t("git.truncated")}</p>}
    </section>
  );
}

function FileRow({
  file,
  diff,
  open,
  onToggle,
}: {
  file: GitFileChange;
  diff: FileDiff | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const slash = file.path.lastIndexOf("/");
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const name = file.path.slice(slash + 1);
  return (
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-panel"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={cn("flex-none text-ink-3 transition-transform", open && "rotate-90")}
        />
        <span
          title={t(`git.state.${file.state}`)}
          className="w-3 flex-none text-center font-mono text-xs font-medium text-ink-2"
        >
          {STATE_LETTER[file.state]}
          <span className="sr-only"> {t(`git.state.${file.state}`)}</span>
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          <span className="text-ink-3">{dir}</span>
          <span className="text-ink">{name}</span>
          {file.from && <span className="text-ink-3"> ← {file.from}</span>}
        </span>
        {file.staged && (
          <span className="flex-none rounded-full bg-panel px-2 text-[11px] text-ink-2">
            {t("git.staged")}
          </span>
        )}
        {diff && !diff.binary && (
          <span className="flex-none font-mono text-xs tabular-nums">
            <span className="text-ok-ink">+{diff.additions}</span>{" "}
            <span className="text-error-ink">−{diff.deletions}</span>
          </span>
        )}
      </button>
      {open && <DiffBody diff={diff} />}
    </li>
  );
}

const LINE_TONE = {
  add: "bg-ok/10 text-ink",
  del: "bg-error-bg text-ink",
  context: "text-ink-2",
  hunk: "bg-panel text-ink-3",
  note: "text-ink-3 italic",
} as const;

function DiffBody({ diff }: { diff: FileDiff | undefined }) {
  if (!diff || diff.lines.length === 0)
    return (
      <p className="border-t border-hairline px-9 py-2 text-xs text-ink-3">
        {diff?.binary ? t("git.binary") : t("git.noDiff")}
      </p>
    );
  return (
    <pre className="overflow-x-auto border-t border-hairline py-1 font-mono text-[11.5px] leading-[1.5]">
      {diff.lines.map((l, i) => (
        // Lines repeat and never move: their place is their identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div key={i} className={cn("min-w-max px-3 whitespace-pre", LINE_TONE[l.kind])}>
          {l.text || " "}
        </div>
      ))}
    </pre>
  );
}
