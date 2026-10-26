import { type GravitaState, sessionCounts } from "@gravita/core";
import {
  House,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  SquareTerminal,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useProjectAppearances } from "@/app/providers";
import { NotificationSettings } from "@/features/notifications/NotificationSettings";
import { RemoveSessionButton } from "@/features/session/RemoveSessionButton";
import { useOpenTerminal } from "@/features/terminal/useOpenTerminal";
import {
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from "@/infrastructure/preferences/sidebarCollapsed";
import { ago, t, useLocale } from "@/shared/i18n/i18n";
import { projectSummaries, sessionStatus, sessionTitle } from "@/shared/presenters/selectors";
import {
  type ProjectItem,
  projectItems,
  squadActive,
  squadCounts,
  squadDecisions,
  squadTitle,
} from "@/shared/presenters/squad";
import { terminalProvider, terminalTitle } from "@/shared/presenters/terminal";
import { ProjectTile } from "@/shared/ui/ProjectTile";
import { ProviderMark } from "@/shared/ui/ProviderMark";
import { TerminalIcon } from "@/shared/ui/TerminalIcon";
import { basename, cn, MOD_KEY } from "@/shared/utils";
import { useAppStore, useNow, useProjection, useRoute, useTerminalSupported } from "@/state/hooks";

/** Below this width the menu folds into the icon rail by itself, until the user chooses. */
const NARROW = "(max-width: 1100px)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof matchMedia === "function" && matchMedia(NARROW).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(NARROW);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export function Sidebar() {
  useLocale();
  const [chosen, setChosen] = useState(() => readSidebarCollapsed());
  const narrow = useNarrow();
  // The user's choice wins in both directions; without one the window width decides.
  const collapsed = chosen ?? narrow;
  const toggle = () => {
    setChosen(!collapsed);
    writeSidebarCollapsed(!collapsed);
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: toggle only closes over `collapsed`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "b")
        return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed]);
  const state = useProjection((p) => p);
  const now = useNow();
  const route = useRoute();
  const navigate = useNavigate();
  const summaries = useMemo(() => projectSummaries(state, now), [state, now]);
  const appearances = useProjectAppearances();
  const terminalsSupported = useTerminalSupported();
  const terminals = useAppStore((s) => s.terminals);
  const focusedTerminal = useAppStore((s) => s.focusedTerminal);
  const placeTerminal = useAppStore((s) => s.placeTerminal);
  const newTerminal = useOpenTerminal((terminal) => {
    placeTerminal(terminal.terminalId);
    navigate({ level: "terminals", terminalId: terminal.terminalId });
  });
  const terminalRows = useMemo(
    () => Object.values(terminals).sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [terminals],
  );
  const currentProject =
    route.level === "project" || route.level === "session" || route.level === "squad"
      ? route.projectId
      : undefined;
  const currentSquad =
    route.level === "squad"
      ? route.squadId
      : route.level === "session"
        ? state.sessions[route.sessionId]?.squadId
        : undefined;

  return (
    <nav
      aria-label="Gravita"
      className={cn(
        "flex h-full flex-none flex-col border-r border-sidebar-edge bg-sidebar transition-[width] motion-reduce:transition-none",
        collapsed ? "w-20" : "w-[232px]",
      )}
    >
      <div data-tauri-drag-region className="h-7 flex-none" />
      <div
        className={cn(
          "flex flex-none items-center",
          collapsed ? "flex-col gap-2 pb-1" : "h-12 justify-between pr-2 pl-4",
        )}
      >
        <Wordmark compact={collapsed} />
        <CollapseButton collapsed={collapsed} onClick={toggle} />
      </div>
      <div className="flex flex-col gap-0.5 px-2 pt-1">
        <NavItem
          collapsed={collapsed}
          prominent
          active={route.level === "home"}
          onClick={() => navigate({ level: "home" })}
          icon={<House size={18} />}
          label={t("nav.home")}
        >
          {t("nav.home")}
        </NavItem>
        {terminalsSupported && (
          <NavItem
            collapsed={collapsed}
            active={false}
            busy={newTerminal.busy}
            onClick={() => void newTerminal.open()}
            icon={<SquareTerminal size={16} />}
            label={t("nav.newTerminal")}
          >
            {t("nav.newTerminal")}
          </NavItem>
        )}
        {newTerminal.error && (
          <p role="alert" className={cn("px-2 text-xs text-error-ink", collapsed && "sr-only")}>
            {newTerminal.error}
          </p>
        )}
      </div>

      {terminalsSupported && (
        <>
          <SectionHeading
            collapsed={collapsed}
            label={t("terminal.list")}
            actionLabel={t("terminals.add")}
            onAction={() => void newTerminal.open()}
          />
          <ul className="flex max-h-40 flex-none flex-col gap-0.5 overflow-y-auto px-2">
            {terminalRows.map((terminal) => {
              const provider = terminalProvider(terminal);
              const title = terminalTitle(provider);
              const active = route.level === "terminals" && focusedTerminal === terminal.terminalId;
              return (
                <li key={terminal.terminalId}>
                  <NavItem
                    collapsed={collapsed}
                    active={active}
                    onClick={() => {
                      placeTerminal(terminal.terminalId);
                      navigate({ level: "terminals", terminalId: terminal.terminalId });
                    }}
                    icon={<TerminalIcon provider={provider} size={16} />}
                    label={`${title} · ${basename(terminal.cwd)}`}
                  >
                    <span className={cn("truncate", !terminal.running && "text-ink-3")}>
                      {title}
                    </span>
                    <span className="min-w-0 truncate text-xs font-normal text-ink-3">
                      {basename(terminal.cwd)}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "ml-auto size-2 flex-none rounded-full",
                        terminal.running ? "bg-ok" : "border border-ink-3",
                      )}
                    />
                  </NavItem>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <SectionHeading
        collapsed={collapsed}
        label={t("nav.projects")}
        actionLabel={t("nav.newProject")}
        onAction={() => navigate({ level: "home", newSession: true })}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {summaries.length === 0 && (
          <p className={cn("px-2 text-sm text-ink-3", collapsed && "sr-only")}>
            {t("nav.noProjects")}
          </p>
        )}
        {summaries.map(({ project, counts }) => {
          const open = currentProject === project.id;
          const items = projectItems(state, project);
          const live = items.filter((item) => {
            if (item.kind === "squad") return squadActive(item.squad);
            const st = sessionStatus(item.session, now);
            return st === "running" || st === "waiting" || st === "idle";
          });
          return (
            <div key={project.id}>
              <NavItem
                collapsed={collapsed}
                active={route.level === "project" && open}
                onClick={() => navigate({ level: "project", projectId: project.id })}
                icon={<ProjectTile name={project.name} appearance={appearances[project.id]} />}
                label={project.name}
                badge={{ count: counts.running + counts.waiting, waiting: counts.waiting > 0 }}
              >
                <span className="truncate">{project.name}</span>
                {counts.running + counts.waiting > 0 && (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-1.5 text-2xs font-bold leading-5 tabular-nums",
                      counts.waiting > 0
                        ? "bg-waiting-bg text-waiting-ink"
                        : "bg-ground text-ink-2",
                    )}
                  >
                    {counts.running + counts.waiting}
                  </span>
                )}
              </NavItem>
              {!collapsed &&
                (open || live.length > 0) &&
                (open ? items.slice(0, 6) : live.slice(0, 3)).map((item) => (
                  <SubItem
                    key={item.kind === "squad" ? `q:${item.squad.id}` : item.session.id}
                    item={item}
                    projectId={project.id}
                    now={now}
                    state={state}
                    active={
                      item.kind === "squad"
                        ? currentSquad === item.squad.id
                        : route.level === "session" && route.sessionId === item.session.id
                    }
                    onOpen={() =>
                      navigate(
                        item.kind === "squad"
                          ? { level: "squad", projectId: project.id, squadId: item.squad.id }
                          : { level: "session", projectId: project.id, sessionId: item.session.id },
                      )
                    }
                  />
                ))}
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "flex items-center gap-1 border-t border-sidebar-edge px-2 py-2",
          collapsed && "flex-col",
        )}
      >
        <button
          type="button"
          onClick={() => navigate({ level: "settings" })}
          aria-label={t("nav.settings")}
          title={t("nav.settings")}
          aria-current={route.level === "settings" ? "page" : undefined}
          className={cn(
            "rounded-md p-2 text-ink-2 hover:bg-sidebar-hover hover:text-ink",
            route.level === "settings" && "bg-sidebar-active text-ink shadow-panel",
          )}
        >
          <Settings size={16} />
        </button>
        <NotificationSettings />
      </div>
    </nav>
  );
}

/** A group's title in the menu, with a "+" that shows on hover (or focus) to add to the group. */
function SectionHeading({
  collapsed,
  label,
  actionLabel,
  onAction,
}: {
  collapsed: boolean;
  label: string;
  actionLabel: string;
  onAction: () => void;
}) {
  // In the icon rail the title shrinks to a short bar that still divides the groups.
  if (collapsed) {
    return (
      <div role="separator" aria-label={label} className="mt-4 mb-2 flex justify-center">
        <span aria-hidden="true" className="h-0.5 w-5 rounded-full bg-hairline-strong" />
      </div>
    );
  }
  return (
    <div className="group/heading mt-4 flex items-center justify-between pr-2 pb-1.5 pl-4 text-xs font-semibold text-ink-3">
      <span>{label}</span>
      <button
        type="button"
        onClick={onAction}
        aria-label={actionLabel}
        title={actionLabel}
        className="rounded-md p-1 text-ink-3 opacity-0 transition-opacity hover:bg-sidebar-hover hover:text-ink focus-visible:opacity-100 group-hover/heading:opacity-100"
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** A session or a squad under its project: status dot, name, live count or age. */
function SubItem({
  item,
  projectId,
  state,
  now,
  active,
  onOpen,
}: {
  item: ProjectItem;
  projectId: string;
  state: GravitaState;
  now: number;
  active: boolean;
  onOpen: () => void;
}) {
  let dot: string;
  let title: string;
  let count: number;
  if (item.kind === "squad") {
    const q = item.squad;
    const c = squadCounts(state, q, now);
    const waiting = c.waiting > 0 || squadDecisions(q).length > 0;
    dot = waiting
      ? "bg-waiting"
      : q.phase === "failed"
        ? "bg-error"
        : squadActive(q)
          ? c.running > 0
            ? "bg-ok"
            : "bg-ink-3"
          : "border border-ink-3";
    title = squadTitle(q);
    count = c.running + c.waiting;
  } else {
    const s = item.session;
    const c = sessionCounts(s, now);
    const st = sessionStatus(s, now);
    dot = cn(
      st === "waiting" && "bg-waiting",
      st === "running" && "bg-ok",
      st === "idle" && "bg-ink-3",
      (st === "done" || st === "detached") && "border border-ink-3",
      st === "error" && "bg-error",
    );
    title = sessionTitle(s) ?? t("session.untitled");
    count = c.running + c.waiting;
  }
  return (
    <div
      className={cn(
        "group/subitem flex w-full items-center gap-0.5 rounded-md py-0.5 pr-1 pl-1",
        active ? "bg-sidebar-active shadow-panel" : "hover:bg-sidebar-hover",
      )}
    >
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onOpen}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pr-1 pl-7 text-left text-sm text-ink-2 hover:text-ink",
          active && "text-ink",
        )}
      >
        {item.kind === "squad" ? (
          <UsersRound size={12} aria-hidden="true" className="flex-none text-ink-3" />
        ) : (
          <span aria-hidden="true" className={cn("size-2 flex-none rounded-full", dot)} />
        )}
        <span className="truncate">{title}</span>
        {item.kind === "session" && <ProviderMark provider={item.session.provider} />}
        {item.kind === "squad" && (
          <span aria-hidden="true" className={cn("size-1.5 flex-none rounded-full", dot)} />
        )}
        <span className="ml-auto flex-none text-2xs text-ink-3 tabular-nums">
          {count > 0 ? count : ago(item.lastEventTs, now)}
        </span>
      </button>
      {item.kind === "session" && (
        <RemoveSessionButton sessionId={item.session.id} projectId={projectId} />
      )}
    </div>
  );
}

function NavItem({
  collapsed,
  prominent,
  active,
  icon,
  label,
  badge,
  busy,
  children,
  onClick,
}: {
  /** The icon rail: the icon alone, centred, with the label kept for assistive tech. */
  collapsed: boolean;
  /** The row that stands out from the rest of the menu (Home): larger, bolder, with an accent bar. */
  prominent?: boolean;
  active: boolean;
  icon: React.ReactNode;
  /** Tooltip, so the collapsed icon rail stays understandable. */
  label: string;
  /** Shown on the icon only in the collapsed rail, where the row's own count is hidden. */
  badge?: { count: number; waiting: boolean };
  busy?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      {...(busy ? { "aria-busy": true } : {})}
      className={cn(
        "relative flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm font-medium text-ink-2 transition-colors hover:bg-sidebar-hover hover:text-ink",
        collapsed && "justify-center px-0",
        prominent && "h-10 text-base font-semibold text-ink",
        active && "bg-sidebar-active text-ink shadow-panel",
        prominent &&
          active &&
          "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-focus",
      )}
    >
      <span className={cn("relative flex-none", prominent ? "text-ink" : "text-ink-3")}>
        {icon}
        {badge && badge.count > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -top-1.5 -right-2 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-[14px] font-bold tabular-nums",
              collapsed ? "flex" : "hidden",
              badge.waiting ? "bg-waiting text-white" : "bg-ink text-ground",
            )}
          >
            {badge.count}
          </span>
        )}
      </span>
      <span className={cn("flex min-w-0 flex-1 items-center gap-2", collapsed && "sr-only")}>
        {children}
      </span>
    </button>
  );
}

/** Wordmark: the name set in DM Sans with a small orbit mark: three line colours around a center. */
export function Wordmark({ compact }: { compact?: boolean } = {}) {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="3.4" fill="var(--ink)" />
        <path
          d="M3 11 A8 8 0 0 1 11 3"
          fill="none"
          stroke="#5b47f0"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M19 11 A8 8 0 0 1 11 19"
          fill="none"
          stroke="#0e9f9a"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M11 3 A8 8 0 0 1 19 11"
          fill="none"
          stroke="#f0552f"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
      {!compact && (
        <span className="text-[15px] font-bold tracking-[-0.02em] text-ink">Gravita</span>
      )}
    </span>
  );
}

/** Folds the menu into the icon rail, or opens it again. */
function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const label = collapsed ? t("nav.expand") : t("nav.collapse");
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-expanded={!collapsed}
      title={`${label} (${MOD_KEY}B)`}
      className="inline-flex size-7 flex-none items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-sidebar-hover hover:text-ink"
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}
