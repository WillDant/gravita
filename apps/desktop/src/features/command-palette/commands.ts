import type { GravitaState } from "@gravita/core";
import type { TerminalInfo } from "@gravita/protocol";
import type { Theme } from "@/app/providers";
import { type Locale, t } from "@/shared/i18n/i18n";
import { agentName } from "@/shared/presenters/agent";
import {
  needsYou,
  projectSummaries,
  sessionStatus,
  sessionTitle,
} from "@/shared/presenters/selectors";
import { projectItems, squadNeedsYou, squadTitle } from "@/shared/presenters/squad";
import { terminalProvider, terminalTitle } from "@/shared/presenters/terminal";
import { basename } from "@/shared/utils";
import type { Route } from "@/state/slices/route";
import { fuzzyMatch } from "./match";

// What the palette offers, as data: the screen turns a target into navigation or an action,
// so building and ranking commands stays pure and testable.

export const PALETTE_GROUPS = [
  "needsYou",
  "actions",
  "sessions",
  "squads",
  "projects",
  "terminals",
] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

export type PaletteAction = "newTerminal" | "toggleTheme" | "switchLanguage" | "stopAll";

export type PaletteTarget =
  | { kind: "route"; route: Route }
  /** A terminal is placed in the split before its screen opens, as the menu does. */
  | { kind: "terminal"; terminalId: string }
  | { kind: "action"; action: PaletteAction };

export interface PaletteCommand {
  id: string;
  group: PaletteGroup;
  label: string;
  /** Where it lives and what state it's in, as text (never colour alone). */
  detail?: string;
  /** Extra words it answers to, never shown. */
  keywords?: string;
  target: PaletteTarget;
}

export interface PaletteContext {
  state: GravitaState;
  terminals: Record<string, TerminalInfo>;
  now: number;
  terminalsSupported: boolean;
  theme: Theme;
  locale: Locale;
}

/** Everything the palette can open or do right now, in group order. */
export function buildCommands(c: PaletteContext): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const { state, now } = c;

  for (const { project, squad, decision } of squadNeedsYou(state)) {
    out.push({
      id: `decision:${squad.id}:${decision.kind}:${decision.kind === "task" ? decision.taskId : ""}`,
      group: "needsYou",
      label: t("palette.squadDecision", { squad: squadTitle(squad) }),
      detail: project.name,
      target: {
        kind: "route",
        route: {
          level: "squad",
          projectId: project.id,
          squadId: squad.id,
          ...(decision.kind === "task" ? { taskId: decision.taskId } : {}),
        },
      },
    });
  }
  for (const { project, session, agent } of needsYou(state, now)) {
    out.push({
      id: `waiting:${session.id}:${agent.id}`,
      group: "needsYou",
      label: `${agentName(agent)} · ${sessionTitle(session) ?? t("session.untitled")}`,
      detail: `${project.name} · ${t("status.waiting")}`,
      target: {
        kind: "route",
        route: {
          level: "session",
          projectId: project.id,
          sessionId: session.id,
          agentId: agent.id,
        },
      },
    });
  }

  out.push({
    id: "action:newSession",
    group: "actions",
    label: t("palette.action.newSession"),
    keywords: "chat squad",
    target: { kind: "route", route: { level: "home", newSession: true } },
  });
  if (c.terminalsSupported) {
    out.push({
      id: "action:newTerminal",
      group: "actions",
      label: t("palette.action.newTerminal"),
      keywords: "shell",
      target: { kind: "action", action: "newTerminal" },
    });
  }
  out.push(
    {
      id: "action:settings",
      group: "actions",
      label: t("palette.action.settings"),
      target: { kind: "route", route: { level: "settings" } },
    },
    {
      id: "action:toggleTheme",
      group: "actions",
      label: t(c.theme === "dark" ? "palette.action.themeLight" : "palette.action.themeDark"),
      keywords: "theme dark light tema escuro claro",
      target: { kind: "action", action: "toggleTheme" },
    },
    {
      id: "action:switchLanguage",
      group: "actions",
      label: t("palette.action.language", {
        language: c.locale === "en" ? t("settings.language.pt") : t("settings.language.en"),
      }),
      keywords: "language idioma english português",
      target: { kind: "action", action: "switchLanguage" },
    },
    {
      id: "action:stopAll",
      group: "actions",
      label: t("palette.action.stopAll"),
      keywords: "kill stop parar",
      target: { kind: "action", action: "stopAll" },
    },
  );

  const summaries = projectSummaries(state, now);
  const sessions: PaletteCommand[] = [];
  const squads: PaletteCommand[] = [];
  const recency = new Map<string, string>();
  for (const { project } of summaries) {
    for (const item of projectItems(state, project)) {
      if (item.kind === "squad") {
        squads.push({
          id: `squad:${item.squad.id}`,
          group: "squads",
          label: squadTitle(item.squad),
          detail: project.name,
          target: {
            kind: "route",
            route: { level: "squad", projectId: project.id, squadId: item.squad.id },
          },
        });
      } else {
        const s = item.session;
        const id = `session:${s.id}`;
        recency.set(id, item.lastEventTs);
        sessions.push({
          id,
          group: "sessions",
          label: sessionTitle(s) ?? t("session.untitled"),
          detail: `${project.name} · ${t(`status.${sessionStatus(s, now)}`)}`,
          target: {
            kind: "route",
            route: { level: "session", projectId: project.id, sessionId: s.id },
          },
        });
      }
    }
  }
  sessions.sort((a, b) => (recency.get(b.id) ?? "").localeCompare(recency.get(a.id) ?? ""));
  out.push(...sessions, ...squads);

  for (const { project, sessions: list } of summaries) {
    out.push({
      id: `project:${project.id}`,
      group: "projects",
      label: project.name,
      detail: t("count.sessions", { count: list.length }),
      target: { kind: "route", route: { level: "project", projectId: project.id } },
    });
  }

  if (c.terminalsSupported) {
    const terminals = Object.values(c.terminals).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
    for (const terminal of terminals) {
      out.push({
        id: `terminal:${terminal.terminalId}`,
        group: "terminals",
        label: `${terminalTitle(terminalProvider(terminal))} · ${basename(terminal.cwd)}`,
        detail: terminal.cwd,
        keywords: "terminal",
        target: { kind: "terminal", terminalId: terminal.terminalId },
      });
    }
  }

  return out;
}

export interface PaletteResult {
  command: PaletteCommand;
  /** Matched letters in the label, for highlighting. */
  indices: number[];
}

/** With nothing typed: what needs you, the actions and the latest sessions. */
const EMPTY_QUERY_LIMIT: Partial<Record<PaletteGroup, number>> = {
  needsYou: Number.POSITIVE_INFINITY,
  actions: Number.POSITIVE_INFINITY,
  sessions: 5,
};
/** Rows per group once the user types. */
const QUERY_LIMIT = 8;

/** The commands that answer `query`, grouped in palette order, best match first in each group. */
export function paletteResults(
  commands: readonly PaletteCommand[],
  query: string,
): { group: PaletteGroup; results: PaletteResult[] }[] {
  const typed = query.trim() !== "";
  const byGroup = new Map<PaletteGroup, (PaletteResult & { score: number; order: number })[]>();
  commands.forEach((command, order) => {
    let hit: { score: number; indices: number[] } | null = null;
    if (typed) {
      const onLabel = fuzzyMatch(query, command.label);
      // The label is what the user reads, so a match there ranks above one in the details.
      if (onLabel) hit = { score: onLabel.score + 5, indices: onLabel.indices };
      else {
        const rest = fuzzyMatch(query, `${command.detail ?? ""} ${command.keywords ?? ""}`);
        if (rest) hit = { score: rest.score, indices: [] };
      }
      if (!hit) return;
    } else if (!(command.group in EMPTY_QUERY_LIMIT)) return;
    const list = byGroup.get(command.group) ?? [];
    list.push({ command, indices: hit?.indices ?? [], score: hit?.score ?? 0, order });
    byGroup.set(command.group, list);
  });

  const out: { group: PaletteGroup; results: PaletteResult[] }[] = [];
  for (const group of PALETTE_GROUPS) {
    const list = byGroup.get(group);
    if (!list) continue;
    list.sort((a, b) => b.score - a.score || a.order - b.order);
    const limit = typed ? QUERY_LIMIT : (EMPTY_QUERY_LIMIT[group] ?? 0);
    out.push({
      group,
      results: list.slice(0, limit).map(({ command, indices }) => ({ command, indices })),
    });
  }
  return out;
}
