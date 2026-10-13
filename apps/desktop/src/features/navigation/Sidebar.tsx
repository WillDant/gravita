import { sessionCounts } from "@gravita/core";
import { Bell, House, Languages, MoonStar, Sun } from "lucide-react";
import { useMemo } from "react";
import { useNavigate, useToggleTheme } from "@/app/providers";
import { ago, getLocale, setLocale, t, useLocale } from "@/shared/i18n/i18n";
import {
  needsYou,
  projectSummaries,
  sessionStatus,
  sessionTitle,
} from "@/shared/presenters/selectors";
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
  const waiting = needsYou(state, now).length;
  const currentProject =
    route.level === "project" || route.level === "session" ? route.projectId : undefined;

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
      </div>

      <div className="mt-5 px-4 pb-1.5 text-xs font-semibold text-ink-3 max-[1100px]:sr-only">
        {t("nav.projects")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {summaries.length === 0 && (
          <p className="px-2 text-sm text-ink-3 max-[1100px]:sr-only">{t("nav.noProjects")}</p>
        )}
        {summaries.map(({ project, sessions, counts }) => {
          const open = currentProject === project.id;
          const liveSessions = sessions.filter((s) => {
            const st = sessionStatus(s, now);
            return st === "running" || st === "waiting" || st === "idle";
          });
          return (
            <div key={project.id}>
              <NavItem
                active={route.level === "project" && open}
                onClick={() => navigate({ level: "project", projectId: project.id })}
                icon={<ProjectMark name={project.name} />}
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
              {(open || liveSessions.length > 0) &&
                (open ? sessions.slice(0, 6) : liveSessions.slice(0, 3)).map((s) => {
                  const c = sessionCounts(s, now);
                  const st = sessionStatus(s, now);
                  const active = route.level === "session" && route.sessionId === s.id;
                  return (
                    <button
                      type="button"
                      key={s.id}
                      aria-current={active ? "page" : undefined}
                      onClick={() =>
                        navigate({ level: "session", projectId: project.id, sessionId: s.id })
                      }
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md py-1 pr-2 pl-8 text-left text-sm text-ink-2 hover:text-ink max-[1100px]:hidden",
                        active ? "bg-ground text-ink shadow-panel" : "hover:bg-panel-2",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-2 flex-none rounded-full",
                          st === "waiting" && "bg-waiting",
                          st === "running" && "bg-ok",
                          st === "idle" && "bg-ink-3",
                          (st === "done" || st === "detached") && "border border-ink-3",
                          st === "error" && "bg-error",
                        )}
                      />
                      <span className="truncate">{sessionTitle(s) ?? t("session.untitled")}</span>
                      <span className="ml-auto flex-none text-2xs text-ink-3 tabular-nums">
                        {c.running + c.waiting > 0
                          ? c.running + c.waiting
                          : ago(s.lastEventTs, now)}
                      </span>
                    </button>
                  );
                })}
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
      </div>
    </nav>
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

/** A project's initial on a small tile, so projects stay distinguishable in the icon rail. */
function ProjectMark({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-4 items-center justify-center rounded-[4px] bg-ink-3/20 text-[10px] font-bold text-ink-2 uppercase"
    >
      {name.replace(/[^a-z0-9]/gi, "").slice(0, 1) || "·"}
    </span>
  );
}
