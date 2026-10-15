import { type GravitaState, sessionCounts } from "@gravita/core";
import { Bell, House, Languages, MoonStar, Settings, Sun, UsersRound } from "lucide-react";
import { useMemo } from "react";
import { useNavigate, useProjectAppearances, useToggleTheme } from "@/app/providers";
import { NotificationSettings } from "@/features/notifications/NotificationSettings";
import { RemoveSessionButton } from "@/features/session/RemoveSessionButton";
import { ago, getLocale, setLocale, t, useLocale } from "@/shared/i18n/i18n";
import { projectSummaries, sessionStatus, sessionTitle } from "@/shared/presenters/selectors";
import {
  needsYouCount,
  type ProjectItem,
  projectItems,
  squadActive,
  squadCounts,
  squadDecisions,
  squadTitle,
} from "@/shared/presenters/squad";
import { ProjectTile } from "@/shared/ui/ProjectTile";
import { ProviderMark } from "@/shared/ui/ProviderMark";
import { cn } from "@/shared/utils";
import { useNow, useProjection, useRoute } from "@/state/hooks";

export function Sidebar() {
  useLocale();
  const state = useProjection((p) => p);
  const now = useNow();
  const route = useRoute();
  const navigate = useNavigate();
  const toggleTheme = useToggleTheme();
  const summaries = useMemo(() => projectSummaries(state, now), [state, now]);
  const appearances = useProjectAppearances();
  const waiting = needsYouCount(state, now);
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
      className="flex h-full w-[232px] flex-none flex-col border-r border-hairline bg-panel max-[1100px]:w-14"
    >
      <div className="flex h-12 items-center gap-2 px-4 max-[1100px]:px-[17px]">
        <Wordmark />
      </div>
      <div className="flex flex-col gap-0.5 px-2">
        <NavItem
          active={route.level === "home"}
          onClick={() => navigate({ level: "home" })}
          icon={<House size={16} />}
          label={t("nav.home")}
        >
          {t("nav.home")}
        </NavItem>
        <NavItem
          active={false}
          onClick={() => navigate({ level: "home" })}
          icon={<Bell size={16} />}
          label={t("nav.needsYou")}
          badge={{ count: waiting, waiting: true }}
        >
          {t("nav.needsYou")}
          {waiting > 0 && (
            <span className="ml-auto rounded-full bg-waiting px-1.5 text-2xs font-bold leading-5 text-white tabular-nums">
              {waiting}
            </span>
          )}
        </NavItem>
        <NavItem
          active={route.level === "settings"}
          onClick={() => navigate({ level: "settings" })}
          icon={<Settings size={16} />}
          label={t("nav.settings")}
        >
          {t("nav.settings")}
        </NavItem>
      </div>

      <div className="mt-5 px-4 pb-1.5 text-xs font-semibold text-ink-3 max-[1100px]:sr-only">
        {t("nav.projects")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {summaries.length === 0 && (
          <p className="px-2 text-sm text-ink-3 max-[1100px]:sr-only">{t("nav.noProjects")}</p>
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
              {(open || live.length > 0) &&
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

      <div className="flex items-center gap-1 border-t border-hairline px-2 py-2 max-[1100px]:flex-col">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={t("theme.toggle")}
          className="rounded-md p-2 text-ink-2 hover:bg-panel-2 hover:text-ink"
        >
          <Sun size={16} className="hidden dark:block" />
          <MoonStar size={16} className="dark:hidden" />
        </button>
        <button
          type="button"
          onClick={() => setLocale(getLocale() === "en" ? "pt-BR" : "en")}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-ink-2 hover:bg-panel-2 hover:text-ink"
        >
          <Languages size={15} />
          <span className="max-[1100px]:sr-only">{getLocale() === "en" ? "EN" : "PT"}</span>
        </button>
        <NotificationSettings />
      </div>
    </nav>
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
        "group/subitem flex w-full items-center gap-0.5 rounded-md py-0.5 pr-1 pl-1 max-[1100px]:hidden",
        active ? "bg-ground shadow-panel" : "hover:bg-panel-2",
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
  active,
  icon,
  label,
  badge,
  children,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  /** Tooltip, so the collapsed icon rail stays understandable. */
  label: string;
  /** Shown on the icon only in the collapsed rail, where the row's own count is hidden. */
  badge?: { count: number; waiting: boolean };
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm font-medium text-ink-2 transition-colors hover:bg-panel-2 hover:text-ink",
        active && "bg-ground text-ink shadow-panel",
      )}
    >
      <span className="relative flex-none text-ink-3">
        {icon}
        {badge && badge.count > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -top-1.5 -right-2 hidden min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] leading-[14px] font-bold tabular-nums max-[1100px]:flex",
              badge.waiting ? "bg-waiting text-white" : "bg-ink text-ground",
            )}
          >
            {badge.count}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 max-[1100px]:sr-only">
        {children}
      </span>
    </button>
  );
}

/** Wordmark: the name set in DM Sans with a small orbit mark: three line colours around a center. */
export function Wordmark() {
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
      <span className="text-[15px] font-bold tracking-[-0.02em] text-ink max-[1100px]:hidden">
        Gravita
      </span>
    </span>
  );
}
