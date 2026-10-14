import type { PlanIssue } from "@gravita/core";
import { type AgentColor, agentColor } from "@gravita/orbs";
import type { AgentProvider, PlanRole, PlanTask, SquadPlan } from "@gravita/protocol";
import { SQUAD_AGENT_PROVIDERS, type SquadAgentProvider } from "@gravita/protocol/constants";
import { ArrowRightLeft, Pencil, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Orb } from "@/features/agents/Orb";
import { t } from "@/shared/i18n/i18n";
import { usd } from "@/shared/presenters/money";
import { modelLabel, roleCode, roleColorKey } from "@/shared/presenters/squad";
import { AutoTextarea, fieldFrame } from "@/shared/ui/form";
import { ProviderMark } from "@/shared/ui/ProviderMark";
import { Button, LineBadge } from "@/shared/ui/ui";
import { cn } from "@/shared/utils";
import { titleOf } from "../model";
import { IDLE } from "../personas";
import { wontFit } from "./planDraft";

export interface TaskEdits {
  edit: (taskId: string, patch: Pick<PlanTask, "title" | "plainSummary">) => void;
  remove: (taskId: string) => void;
  move: (taskId: string, roleId: string) => void;
}

/**
 * One role on the Board as the strip map over a train's door: the role's line runs down
 * the column, each task a stop on it, in the order they run.
 */
export function RoleStrip({
  plan,
  role,
  provider,
  onProvider,
  tasks,
  estimateUsd,
  issues,
  taskIssues,
  strong,
  notes,
  edits,
}: {
  plan: SquadPlan;
  role: PlanRole;
  /** The agent that runs this role. */
  provider: AgentProvider;
  /** A mixed squad lets the user move the role between Claude Code and Codex. */
  onProvider?: (provider: SquadAgentProvider) => void;
  tasks: PlanTask[];
  estimateUsd?: number;
  issues: PlanIssue[];
  taskIssues: Map<string, PlanIssue[]>;
  /**
   * Tasks the squad's model policy runs on their provider's strongest tier, with that
   * model (marked on their cards).
   */
  strong?: ReadonlyMap<string, string>;
  notes: Map<string, string[]>;
  edits: TaskEdits;
}) {
  const key = roleColorKey(role, plan);
  const color = agentColor(key);
  return (
    <section
      aria-label={role.name}
      className="flex w-[300px] flex-none flex-col rounded-xl border border-hairline bg-ground"
    >
      <header className="flex flex-col gap-2 border-b border-hairline px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2.5">
          <Orb
            color={color}
            persona={IDLE}
            size={28}
            glyph={false}
            motion="ambient"
            seed={role.id}
          />
          <LineBadge agentType={key} code={roleCode(role)} title={role.name} size={18} />
          <h3 className="min-w-0 flex-1 truncate text-md font-semibold">{role.name}</h3>
          {!onProvider && <ProviderMark provider={provider} />}
          <span className="tabular text-xs text-ink-2" title={t("squad.board.roleBudget")}>
            {role.budgetUsd !== undefined
              ? usd(role.budgetUsd)
              : estimateUsd !== undefined
                ? `≈ ${usd(estimateUsd)}`
                : ""}
          </span>
        </div>
        <ul aria-label={t("squad.board.owns")} className="flex flex-wrap gap-1">
          {role.owns.map((o) => (
            <li
              key={o}
              className="max-w-full truncate rounded-md bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
            >
              {o}
            </li>
          ))}
        </ul>
        {onProvider && (
          <ProviderSwitch role={role.name} provider={provider} onChange={onProvider} />
        )}
        {role.charter && <p className="line-clamp-2 text-xs text-ink-3">{role.charter}</p>}
        {issues.map((i) => (
          <p key={i.message} className="text-xs font-medium text-error-ink">
            {i.message}
          </p>
        ))}
      </header>
      <ol className="relative flex flex-col px-4 pt-3 pb-4">
        {/* The role's line, running down through its stops. */}
        <span
          aria-hidden="true"
          className="absolute top-0 bottom-6 left-[25px] w-[5px] rounded-full"
          style={{ background: color.line }}
        />
        {tasks.length === 0 && (
          <li className="relative pl-8 text-sm text-ink-3">{t("squad.board.noTasks")}</li>
        )}
        {tasks.map((task) => (
          <TaskStop
            key={task.id}
            plan={plan}
            task={task}
            color={color}
            issues={taskIssues.get(task.id) ?? []}
            {...(strong?.has(task.id) ? { strongModel: strong.get(task.id) } : {})}
            notes={notes.get(task.id) ?? []}
            edits={edits}
          />
        ))}
      </ol>
    </section>
  );
}

type Mode = "view" | "edit" | "move" | "remove";

/**
 * Which agent runs the role, as a two-way segmented control (a mixed squad only): the
 * user may move a role between Claude Code and Codex before approving.
 */
function ProviderSwitch({
  role,
  provider,
  onChange,
}: {
  role: string;
  provider: AgentProvider;
  onChange: (provider: SquadAgentProvider) => void;
}) {
  const name = useId();
  const options = SQUAD_AGENT_PROVIDERS;
  return (
    <fieldset className="w-max">
      <legend className="sr-only">{t("squad.board.providerOf", { role })}</legend>
      <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-panel p-0.5">
        {options.map((p) => (
          <label
            key={p}
            className={cn(
              "flex h-6 cursor-pointer items-center rounded-md px-2.5 text-xs font-semibold transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
              provider === p ? "bg-ground text-ink shadow-panel" : "text-ink-2 hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={p}
              checked={provider === p}
              onChange={() => onChange(p)}
              className="sr-only"
            />
            {t(`newSession.provider.${p}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TaskStop({
  plan,
  task,
  color,
  issues,
  strongModel,
  notes,
  edits,
}: {
  plan: SquadPlan;
  task: PlanTask;
  color: AgentColor;
  issues: PlanIssue[];
  /** Set when the task runs on its provider's strongest tier: that model. */
  strongModel?: string;
  notes: string[];
  edits: TaskEdits;
}) {
  const [mode, setMode] = useState<Mode>("view");
  const [title, setTitle] = useState(task.title);
  const [summary, setSummary] = useState(task.plainSummary);
  const id = useId();
  const dependants = plan.tasks.filter((x) => x.dependsOn.includes(task.id));
  const bad = issues.length > 0;

  return (
    <li className="group relative py-2.5 pl-8">
      {/* The stop: a station on the role's line. A foundation task gets a pip in the
          role's hue (a filled ink dot means "running" on the map, so it isn't used). */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[15px] left-[3px] flex size-[13px] items-center justify-center rounded-full border-2 bg-ground",
          bad ? "border-error" : "border-ink",
        )}
      >
        {task.foundation && (
          <span className="size-[5px] rounded-full" style={{ background: color.line }} />
        )}
      </span>
      {mode === "edit" ? (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || !summary.trim()) return;
            edits.edit(task.id, {
              title: title.trim().slice(0, 80),
              plainSummary: summary.trim().slice(0, 280),
            });
            setMode("view");
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={`${id}-title`} className="sr-only">
            {t("squad.board.taskTitle")}
          </label>
          <div className={fieldFrame}>
            <input
              id={`${id}-title`}
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 w-full bg-transparent px-2.5 text-sm font-semibold text-ink outline-none focus-visible:outline-none"
            />
          </div>
          <label htmlFor={`${id}-summary`} className="sr-only">
            {t("squad.board.taskSummary")}
          </label>
          <div className={cn(fieldFrame, "px-2.5 py-1.5")}>
            <AutoTextarea
              id={`${id}-summary`}
              value={summary}
              maxLength={280}
              onChange={(e) => setSummary(e.target.value)}
              maxRows={6}
              className="text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary">
              {t("squad.board.save")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setTitle(task.title);
                setSummary(task.plainSummary);
                setMode("view");
              }}
            >
              {t("newSession.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <h4 className="min-w-0 flex-1 text-base leading-snug font-semibold">{task.title}</h4>
            <div className="flex flex-none gap-0.5">
              <IconButton
                label={t("squad.board.edit", { task: task.title })}
                onClick={() => setMode("edit")}
              >
                <Pencil size={13} />
              </IconButton>
              <IconButton
                label={t("squad.board.move", { task: task.title })}
                onClick={() => setMode(mode === "move" ? "view" : "move")}
              >
                <ArrowRightLeft size={13} />
              </IconButton>
              <IconButton
                label={t("squad.board.remove", { task: task.title })}
                onClick={() => setMode(mode === "remove" ? "view" : "remove")}
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          </div>
          <p className="mt-0.5 text-sm text-ink-2">{task.plainSummary}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
            <span className="font-medium text-ink-2">{t(`squad.size.${task.size}`)}</span>
            {task.foundation && (
              <span className="rounded-full bg-panel px-1.5 font-medium text-ink-2">
                {t("squad.board.foundation")}
              </span>
            )}
            {strongModel && (
              // Signage, not a status: hairline ring, ink text, no colour of its own.
              <span
                title={t("squad.board.onStrong")}
                className="rounded-full border border-hairline px-1.5 font-semibold text-ink-2"
              >
                {modelLabel(strongModel)}
                <span className="sr-only">{`. ${t("squad.board.onStrong")}`}</span>
              </span>
            )}
            {task.dependsOn.length > 0 && (
              <span>
                {t("squad.board.after", {
                  tasks: task.dependsOn.map((d) => titleOf(plan, d)).join(", "),
                })}
              </span>
            )}
          </p>
          <p
            className="mt-1 truncate font-mono text-[11px] text-ink-3"
            title={task.writes.join("\n")}
          >
            {task.writes.slice(0, 2).join("  ")}
            {task.writes.length > 2 && `  +${task.writes.length - 2}`}
          </p>
        </>
      )}

      {mode === "move" && (
        <MoveTo
          plan={plan}
          task={task}
          onMove={(r) => {
            edits.move(task.id, r);
            setMode("view");
          }}
        />
      )}
      {mode === "remove" && (
        <div className="mt-2 rounded-lg border border-hairline bg-panel p-2.5">
          <p className="text-xs text-ink-2">
            {dependants.length > 0
              ? t("squad.board.removeDependants", {
                  tasks: dependants.map((d) => d.title).join(", "),
                })
              : t("squad.board.removeAlone")}
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={() => edits.remove(task.id)}>
              {t("squad.board.removeYes")}
            </Button>
            <Button variant="ghost" onClick={() => setMode("view")}>
              {t("newSession.cancel")}
            </Button>
          </div>
        </div>
      )}

      {notes.map((n) => (
        <p key={n} className="mt-1.5 text-xs text-ink-2">
          {n}
        </p>
      ))}
      {issues.map((i) => (
        <p key={i.message} className="mt-1.5 text-xs font-medium text-error-ink">
          {i.message}
        </p>
      ))}
    </li>
  );
}

/** The roles a task could move to; one that doesn't own its paths says which. */
function MoveTo({
  plan,
  task,
  onMove,
}: {
  plan: SquadPlan;
  task: PlanTask;
  onMove: (roleId: string) => void;
}) {
  const others = plan.roles.filter((r) => r.kind !== "planner" && r.id !== task.role);
  const [why, setWhy] = useState<{ role: string; paths: string[] }>();
  return (
    <div className="mt-2 rounded-lg border border-hairline bg-panel p-2.5">
      <p className="mb-1.5 text-xs font-semibold text-ink-2">{t("squad.board.moveTo")}</p>
      {others.length === 0 && <p className="text-xs text-ink-3">{t("squad.board.noOtherRoles")}</p>}
      <div className="flex flex-wrap gap-1.5">
        {others.map((r) => {
          const outside = wontFit(plan, task.id, r.id);
          return (
            <button
              key={r.id}
              type="button"
              aria-disabled={outside.length > 0}
              onClick={() =>
                outside.length ? setWhy({ role: r.name, paths: outside }) : onMove(r.id)
              }
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border border-hairline-strong bg-ground pr-2.5 pl-1 text-xs font-medium transition-colors",
                outside.length ? "text-ink-3" : "text-ink hover:bg-panel-2",
              )}
            >
              <LineBadge
                agentType={roleColorKey(r, plan)}
                code={roleCode(r)}
                size={18}
                dim={outside.length > 0}
              />
              {r.name}
            </button>
          );
        })}
      </div>
      {why && (
        <p role="status" className="mt-2 text-xs text-ink-2">
          {t("squad.board.wontFit", { role: why.role })}{" "}
          <span className="font-mono text-[11px] text-ink">{why.paths.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md p-1.5 text-ink-3 transition-colors hover:bg-panel hover:text-ink"
    >
      {children}
    </button>
  );
}
