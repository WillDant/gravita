import type { ProjectState, SessionState } from "@gravita/core";
import { sessionCounts } from "@gravita/core";
import type { GravitaEvent, TerminalInfo } from "@gravita/protocol";
import {
  ChevronRight,
  Columns2,
  FolderTree,
  Map as MapIcon,
  PanelRightClose,
  Terminal,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { useNavigate } from "@/app/providers";
import { START_SIZE, TerminalView } from "@/features/terminal/TerminalView";
import { t, useLocale } from "@/shared/i18n/i18n";
import { describeError } from "@/shared/presenters/errors";
import { sessionProvider, sessionTitle } from "@/shared/presenters/selectors";
import { ProviderMark } from "@/shared/ui/ProviderMark";
import { SplitPane } from "@/shared/ui/SplitPane";
import { Tabs } from "@/shared/ui/Tabs";
import { Button, CountChips } from "@/shared/ui/ui";
import { basename, cn } from "@/shared/utils";
import {
  useNow,
  useProjection,
  useSessionEvents,
  useSessionTerminal,
  useStartingSessionId,
  useTerminalControl,
  useTerminalSupported,
  useUsageRefresh,
} from "@/state/hooks";
import { AgentPanel } from "./agent-panel/AgentPanel";
import { Composer } from "./composer/Composer";
import { Explorer } from "./files/Explorer";
import { FileTabs } from "./files/FileTabs";
import { type ProjectTabs, useProjectTabs } from "./files/openFiles";
import { type FileActions, useFileActions } from "./files/useFileActions";
import { GitButton } from "./git/GitPanel";
import { Happening } from "./happening/Happening";
import { LineMap } from "./line-map/LineMap";
import { TreeLens } from "./tree-lens/TreeLens";

// The Conversation and Orbit lenses (renderer, canvas scene and all) load on first open,
// off the initial bundle.
const ConversationLens = lazy(() => import("./conversation/ConversationLens"));
const OrbitLens = lazy(() => import("./orbit-lens/OrbitLens"));
// The editor (CodeMirror and its languages) loads when the first file opens.
const FileEditor = lazy(() => import("./files/FileEditor"));

const LENSES = ["lines", "orbit", "tree"] as const;
type Lens = (typeof LENSES)[number];

/**
 * How the session screen is split: what you talk to (terminal or conversation) beside the
 * map, either one alone, or the map in full with the agent column (the classic view).
 */
const LAYOUTS = ["split", "talk", "map"] as const;
type Layout = (typeof LAYOUTS)[number];
const LAYOUT_KEY = "gravita.session.layout";

function readLayout(): Layout {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return (LAYOUTS as readonly string[]).includes(v ?? "") ? (v as Layout) : "split";
  } catch {
    return "split";
  }
}

function useLayout(): [Layout, (l: Layout) => void] {
  const [layout, setLayout] = useState(readLayout);
  return [
    layout,
    (next) => {
      setLayout(next);
      try {
        localStorage.setItem(LAYOUT_KEY, next);
      } catch {}
    },
  ];
}

/** Whether the right pane shows the file explorer instead of the map. */
const EXPLORER_KEY = "gravita.session.explorer";

function useExplorer(): [boolean, (on: boolean | ((on: boolean) => boolean)) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(EXPLORER_KEY) === "1";
    } catch {
      return false;
    }
  });
  return [
    on,
    (next) =>
      setOn((was) => {
        const value = typeof next === "function" ? next(was) : next;
        try {
          localStorage.setItem(EXPLORER_KEY, value ? "1" : "0");
        } catch {}
        return value;
      }),
  ];
}

const isExplorerKey = (e: KeyboardEvent) =>
  (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "e";

type Talk = "terminal" | "conversation" | "file";

export function Session({
  projectId,
  sessionId,
  agentId,
}: {
  projectId: string;
  sessionId: string;
  agentId?: string;
}) {
  useLocale();
  const session = useProjection((p) => p.sessions[sessionId]);
  const project = useProjection((p) => p.projects[projectId]);
  const terminal = useSessionTerminal(sessionId);
  const starting = useStartingSessionId();

  if (!session && !terminal) {
    return starting === sessionId ? (
      <p role="status" className="p-8 text-ink-2">
        {t("session.starting")}
      </p>
    ) : null;
  }
  return (
    <Workspace
      projectId={projectId}
      sessionId={sessionId}
      {...(session ? { session } : {})}
      {...(project ? { project } : {})}
      {...(terminal ? { terminal } : {})}
      {...(agentId ? { agentId } : {})}
    />
  );
}

/**
 * The session's screen: talk on the left (its terminal, or the conversation), the map on
 * the right (a lens over the agent's details). A terminal that runs no session yet shows
 * here too, its map waiting for the session to start.
 */
export function Workspace({
  projectId,
  sessionId,
  session,
  project,
  terminal,
  agentId,
}: {
  projectId: string;
  sessionId?: string;
  session?: SessionState;
  project?: ProjectState;
  terminal?: TerminalInfo;
  agentId?: string;
}) {
  const events = useSessionEvents(sessionId ?? "");
  const now = useNow();
  // An open chat or squad keeps plan usage fresh (cheap: read through its running session).
  useUsageRefresh(session ? sessionProvider(session) : "claude");
  const navigate = useNavigate();
  const [layout, setLayout] = useLayout();
  const [lens, setLens] = useState<Lens>("lines");
  const [talk, setTalk] = useState<Talk>("terminal");
  const [explorer, setExplorer] = useExplorer();
  const cwd = session?.cwd ?? terminal?.cwd;
  const files = useProjectTabs(cwd);
  const fileActions = useFileActions(cwd);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isExplorerKey(e)) return;
      e.preventDefault();
      setExplorer((on) => !on);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setExplorer]);

  const select = (id?: string) => {
    if (!sessionId) return;
    navigate({ level: "session", projectId, sessionId, ...(id ? { agentId: id } : {}) });
  };
  const selected = agentId && session ? session.agents[agentId] : undefined;
  const projectName = project?.name ?? basename(terminal?.cwd ?? "");
  const title = session
    ? (sessionTitle(session) ?? t("session.untitled"))
    : t(`terminal.title.${terminal?.command ?? "shell"}`);

  const onTerminalGone = () => navigate({ level: "project", projectId });
  const onReplaced = (next: TerminalInfo) => {
    // A resumed session stays on its screen; a new process may not run one yet.
    if (!next.sessionId) navigate({ level: "terminal", projectId, terminalId: next.terminalId });
    else if (next.sessionId !== sessionId)
      navigate({ level: "session", projectId, sessionId: next.sessionId });
  };

  const map = session ? (
    <MapLens
      lens={lens}
      session={session}
      project={project}
      events={events}
      now={now}
      agentId={agentId}
      onSelect={select}
    />
  ) : (
    <p className="px-6 py-6 text-sm text-ink-2">
      {terminal?.sessionId ? t("session.mapEmpty") : t("terminal.waiting")}
    </p>
  );
  const details = session ? (
    selected ? (
      <AgentPanel
        session={session}
        agent={selected}
        events={events}
        now={now}
        onClose={() => select()}
        onSelect={select}
      />
    ) : (
      <Happening session={session} now={now} onSelect={select} />
    )
  ) : null;
  // "File" shows only while a file is open; without a terminal, talk is the conversation.
  const shownTalk: Talk =
    talk === "file" && files.tabs.length > 0
      ? "file"
      : terminal && talk !== "conversation"
        ? "terminal"
        : "conversation";
  const openFile = (path: string) => {
    fileActions.open(path);
    setTalk("file");
    // The map alone has no room for the editor: bring the talk side back.
    if (layout === "map") setLayout("split");
  };
  const lensTabs = (
    <Tabs
      label={t("session.map")}
      items={LENSES.map((l) => ({ value: l, label: t(`session.lens.${l}`) }))}
      value={lens}
      onChange={setLens}
    />
  );

  // The map alone is the classic view: the lens across, the agent column beside it.
  const wide = layout === "map";
  const talkPane = (
    <TalkPane
      session={session}
      terminal={terminal}
      talk={shownTalk}
      setTalk={setTalk}
      files={files}
      fileActions={fileActions}
      onSelect={select}
      onTerminalGone={onTerminalGone}
      onReplaced={onReplaced}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <button
            type="button"
            className="text-ink-2 hover:text-ink"
            onClick={() => navigate({ level: "home" })}
          >
            {t("nav.home")}
          </button>
          <ChevronRight size={14} className="text-ink-3" aria-hidden="true" />
          <button
            type="button"
            className="truncate text-ink-2 hover:text-ink"
            onClick={() => navigate({ level: "project", projectId })}
          >
            {projectName}
          </button>
          <ChevronRight size={14} className="text-ink-3" aria-hidden="true" />
          <span className="truncate font-semibold text-ink" aria-current="page">
            {title}
          </span>
          {session && <ProviderMark provider={session.provider} className="ml-0.5" />}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {session && <CountChips counts={sessionCounts(session, now)} scope="session" />}
          {cwd && <GitButton key={cwd} cwd={cwd} />}
          {cwd && <ExplorerButton on={explorer} onChange={setExplorer} />}
          <LayoutSwitch value={layout} onChange={setLayout} />
        </div>
      </header>

      {/* One tree for every layout: hiding a side keeps its terminal and map alive. */}
      <SplitPane
        storageKey="gravita.session.map-width"
        label={t("session.resizeMap")}
        show={
          layout === "split" || (layout === "talk" && explorer && cwd)
            ? "both"
            : layout === "talk"
              ? "start"
              : "end"
        }
        start={talkPane}
        end={
          <>
            {explorer && cwd && (
              <Explorer
                root={cwd}
                {...(shownTalk === "file" && files.active ? { activePath: files.active } : {})}
                onOpen={openFile}
              />
            )}
            {/* Hidden, not unmounted, behind the explorer: the map keeps its state. */}
            <div
              hidden={Boolean(explorer && cwd)}
              className={cn("flex h-full min-h-0", wide ? "flex-row" : "flex-col")}
            >
              <div className={cn("flex min-h-0 min-w-0 flex-col", wide ? "flex-1" : "flex-[3]")}>
                <div className="flex flex-none items-center px-4 pt-3 pb-2">{lensTabs}</div>
                <div className="min-h-0 flex-1">{map}</div>
              </div>
              {details && (
                <div
                  className={cn(
                    "relative flex flex-col border-hairline",
                    wide ? "w-[340px] flex-none border-l" : "min-h-[200px] flex-[2] border-t",
                  )}
                >
                  {details}
                </div>
              )}
            </div>
          </>
        }
      />
    </div>
  );
}

function LayoutSwitch({ value, onChange }: { value: Layout; onChange: (l: Layout) => void }) {
  const icons: Record<Layout, ReactNode> = {
    split: <Columns2 size={15} aria-hidden="true" />,
    talk: <PanelRightClose size={15} aria-hidden="true" />,
    map: <MapIcon size={15} aria-hidden="true" />,
  };
  return (
    <fieldset className="flex rounded-lg bg-panel p-0.5">
      <legend className="sr-only">{t("session.layout")}</legend>
      {LAYOUTS.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={value === l}
          aria-label={t(`session.layout.${l}`)}
          title={t(`session.layout.${l}`)}
          onClick={() => onChange(l)}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md text-ink-2 transition-colors",
            value === l ? "bg-ground text-ink shadow-panel" : "hover:text-ink",
          )}
        >
          {icons[l]}
        </button>
      ))}
    </fieldset>
  );
}

function ExplorerButton({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const label = on ? t("files.hideExplorer") : t("files.showExplorer");
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={`${label} (⇧⌘E)`}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-panel hover:text-ink",
        on && "bg-panel text-ink",
      )}
    >
      <FolderTree size={16} aria-hidden="true" />
    </button>
  );
}

function MapLens({
  lens,
  session,
  project,
  events,
  now,
  agentId,
  onSelect,
}: {
  lens: Lens;
  session: SessionState;
  project?: ProjectState;
  events: GravitaEvent[];
  now: number;
  agentId?: string;
  onSelect: (id?: string) => void;
}) {
  if (lens === "lines")
    return (
      <LineMap
        session={session}
        events={events}
        now={now}
        selectedAgentId={agentId}
        onSelectAgent={onSelect}
      />
    );
  if (lens === "orbit")
    return (
      <Suspense fallback={null}>
        <OrbitLens
          session={session}
          project={project ?? { id: session.projectId, name: basename(session.cwd) }}
          now={now}
          selectedAgentId={agentId}
          onSelect={onSelect}
        />
      </Suspense>
    );
  return <TreeLens session={session} now={now} selectedAgentId={agentId} onSelect={onSelect} />;
}

/** What you talk to: the session's terminal, or its conversation (with the composer). */
function TalkPane({
  session,
  terminal,
  talk,
  setTalk,
  files,
  fileActions,
  onSelect,
  onTerminalGone,
  onReplaced,
}: {
  session?: SessionState;
  terminal?: TerminalInfo;
  talk: Talk;
  setTalk: (talk: Talk) => void;
  files: ProjectTabs;
  fileActions: FileActions;
  onSelect: (id?: string) => void;
  onTerminalGone: () => void;
  onReplaced: (next: TerminalInfo) => void;
}) {
  const items = [
    ...(terminal ? [{ value: "terminal" as const, label: t("session.talk.terminal") }] : []),
    ...(session ? [{ value: "conversation" as const, label: t("session.talk.conversation") }] : []),
    ...(files.tabs.length > 0 ? [{ value: "file" as const, label: t("session.talk.file") }] : []),
  ];
  const activeFile = files.tabs.find((f) => f.path === files.active) ?? files.tabs[0];
  const closeFile = (path: string) => {
    // The last tab closed: back to what was there before.
    if (fileActions.close(path) && files.tabs.length === 1)
      setTalk(terminal ? "terminal" : "conversation");
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      {items.length > 1 && (
        <div className="flex flex-none items-center px-4 pt-3 pb-2">
          <Tabs label={t("session.talk")} items={items} value={talk} onChange={setTalk} />
        </div>
      )}
      {files.tabs.length > 0 && (
        <FileTabs
          tabs={files.tabs}
          {...(talk === "file" && activeFile ? { active: activeFile.path } : {})}
          onActivate={(path) => {
            fileActions.activate(path);
            setTalk("file");
          }}
          onClose={closeFile}
        />
      )}
      {talk === "file" && activeFile ? (
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <FileEditor
              file={activeFile}
              onChange={(text) => fileActions.edit(activeFile.path, text)}
              onSave={() => void fileActions.save(activeFile.path)}
              onReload={() => fileActions.reload(activeFile.path)}
              onOverwrite={() => void fileActions.save(activeFile.path, { overwrite: true })}
            />
          </Suspense>
        </div>
      ) : terminal && talk === "terminal" ? (
        <div className="min-h-0 flex-1">
          <TerminalView terminal={terminal} onClosed={onTerminalGone} onReplaced={onReplaced} />
        </div>
      ) : (
        session && (
          <>
            <div className="min-h-0 flex-1">
              <Suspense fallback={null}>
                <ConversationLens session={session} onSelect={onSelect} />
              </Suspense>
            </div>
            {session.controllable ? (
              <Composer session={session} />
            ) : (
              session.kind === "external" && (
                <WatchingBar session={session} hasTerminal={Boolean(terminal)} />
              )
            )}
          </>
        )
      )}
    </div>
  );
}

/**
 * Under an observed session: it runs elsewhere. A session that no longer runs anywhere can
 * be picked up again in a terminal here.
 */
function WatchingBar({ session, hasTerminal }: { session: SessionState; hasTerminal: boolean }) {
  const supported = useTerminalSupported();
  const { spawn } = useTerminalControl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // A Cursor chat Gravita runs can't be picked up by the CLI; one seen in a terminal can.
  const provider = sessionProvider(session);
  const resumable = provider !== "cursor" || session.kind === "external";
  const canContinue = supported && !hasTerminal && !session.live && resumable;
  const resume = async () => {
    if (!resumable) return;
    setBusy(true);
    setError(undefined);
    const r = await spawn({
      cwd: session.cwd,
      command: provider,
      resume: session.id,
      ...START_SIZE,
    });
    setBusy(false);
    if (!r.ok) setError(t("terminal.failed", { reason: describeError(r.error).text }));
  };
  return (
    <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline bg-panel px-6 py-2.5 text-sm text-ink-2">
      <Terminal size={15} aria-hidden="true" />
      {t("session.watching")}
      <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{session.cwd}</span>
      {canContinue && (
        <Button aria-busy={busy} onClick={() => void resume()}>
          {t("terminal.continue")}
        </Button>
      )}
      {error && (
        <p role="alert" className="w-full text-xs text-error-ink">
          {error}
        </p>
      )}
    </div>
  );
}
