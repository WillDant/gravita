import { CHECK_PROGRAMS, RESERVED_ROLE_IDS, type SquadState } from "@gravita/core";
import type { PlanRole, PlanTask, SquadPlan } from "@gravita/protocol";

// What Gravita tells its agents. The charters are appended to Claude Code's own system
// prompt (so the prompt cache holds across a role's tasks); the per-task text is the first
// message of each session. Plain, specific and short: these are instructions, not essays.

const list = (items: readonly string[]) => items.map((i) => `- ${i}`).join("\n");

export const PLANNER_CHARTER = `You are the planner of a Gravita squad: a small team of Claude Code agents, each owning part of one repository, that builds what the user asked for. You plan; you never change files. Read the repository (Read, Grep, Glob) as much as you need, then answer with a SquadPlan as structured output.

How to plan:
- Split the work by roles with disjoint ownership. Each role "owns" path prefixes — plain folders or files like "apps/api/" or "packages/ui/", never patterns like "apps/api/**" — that no other role owns; a task may only write inside its role's prefixes. Default to 3 roles (for example backend, frontend, tests); fewer for a small change, never more than the work needs.
- Contract first. Put the shared interfaces (an OpenAPI file, shared TypeScript types, design tokens) and the scaffold in foundation tasks ("foundation": true). Foundation runs before anything else and the contracts are then frozen, so every role builds against them in parallel. List each contract under "contracts" with the role that owns it; its path must sit inside that role's prefixes.
- Shared files belong to Gravita, not to a role: lockfiles, the root package.json, the workspace file, CI config. List them under "shared.paths" (strategy "regenerate"). No role may own them; Gravita regenerates them after each merge.
- Keep it small: about 12 tasks or fewer for a small app. Each task is a coherent change one agent can finish in one session (size s, m or l), with "writes" (the paths it changes, inside its role's prefixes), "dependsOn" (task ids), and concrete "acceptance" criteria an agent can check.
- Write every "plainSummary" for someone who doesn't read code: what it gives the user, in one sentence, no jargon.
- Checks are argv arrays run without a shell, from the repository root or a repo-relative "cwd". The program must be one of: ${[...CHECK_PROGRAMS].join(", ")}. No shell characters (; | & $ \` < >). "task" checks run after each task, "integration" after each merge, "final" before delivery. Only add checks that will exist once the plan is done (scripts that a task creates).
- Role ids are short lowercase slugs; "${[...RESERVED_ROLE_IDS].join('", "')}" is reserved. Paths are repo-relative, with "/" and no leading "./" or "..".
- When something is unclear and it changes the plan, ask it in "questions" instead of guessing; put what you assumed in "assumptions". The user answers before anything runs.

Answer only with the plan.`;

export const BRIEFING_CHARTER = `You are the planner of a Gravita squad: a small team of Claude Code agents, each owning part of one repository, that builds what the user asked for. Right now you are being briefed. Before anything is planned, make sure you understand what the user wants, by talking with them.

How to brief:
- Look around the repository (Read, Grep, Glob) as much as you need to ask good questions. You can't change anything.
- Ask short, concrete clarifying questions, a few at a time (three at most), and only those whose answers change what gets built. Prefer choices: use AskUserQuestion with two to four options when the answer is a pick.
- Say plainly what you're assuming where you don't ask.
- Don't write a plan, a task list or code yet. Gravita asks you for the plan when the user is ready.
- When you have enough to plan, say so in one sentence, so the user can ask for the plan.`;

/** One message of the briefing conversation, for a planner that can't resume it. */
export interface BriefingLine {
  role: "user" | "assistant";
  text: string;
}

/** The briefing as text is capped: the newest part matters most, the brief is sent anyway. */
export const MAX_BRIEFING_CHARS = 12_000;

function briefingText(lines: readonly BriefingLine[]): string {
  const out: string[] = [];
  let size = 0;
  for (const l of [...lines].reverse()) {
    const line = `${l.role === "user" ? "User" : "You"}: ${l.text.trim()}`;
    if (size + line.length > MAX_BRIEFING_CHARS) {
      out.push("[earlier messages left out]");
      break;
    }
    out.push(line);
    size += line.length;
  }
  return out.reverse().join("\n\n");
}

function budgetLine(q: SquadState) {
  const plan = q.budgetPlan;
  // A plan share has no dollar figure to split, so roles get no dollar budgets of their own.
  const budget = plan
    ? `Budget: at most ${plan.maxPercent}% of the user's ${plan.window === "five_hour" ? "5-hour" : "weekly"} plan usage limit for the whole squad. Leave the roles' \`budgetUsd\` unset.`
    : `Budget: $${q.budgetUsd} for the whole squad.`;
  // Under Automatic a role's `model` would override Gravita's per-task choice.
  if (q.models.mode === "auto")
    return `${budget} Gravita picks each task's model: "${q.models.roles}" for most work, a stronger one for foundation tasks, tasks that write a contract, and large tasks. Leave the roles' \`model\` unset unless the user asked for a specific model.`;
  return `${budget} Roles run on "${q.models.roles}".`;
}

function feedbackParts(q: SquadState, feedback?: string): string[] | undefined {
  if (!q.plan || !feedback) return undefined;
  return [
    `Your previous plan:\n${JSON.stringify(q.plan)}`,
    `The user's feedback on it:\n${feedback}\n\nPropose a new plan that takes the feedback into account.`,
  ];
}

/**
 * The first message of a fresh planner session. `briefing` is the conversation the user had
 * with the planner before, when its session can't be resumed (after a restart).
 */
export function plannerPrompt(
  q: SquadState,
  feedback?: string,
  briefing: readonly BriefingLine[] = [],
): string {
  const parts = [`The user's brief:\n${q.brief}`];
  if (briefing.length)
    parts.push(
      `Before planning, you talked with the user about the brief (oldest first):\n${briefingText(briefing)}`,
    );
  parts.push(budgetLine(q));
  parts.push(
    ...(feedbackParts(q, feedback) ?? [
      "Read the repository first if it has code, then propose the plan.",
    ]),
  );
  return parts.join("\n\n");
}

/** The first message of a planner that resumes the briefing (or its own earlier session). */
export function resumedPlannerPrompt(q: SquadState, feedback?: string): string {
  return [
    budgetLine(q),
    ...(feedbackParts(q, feedback) ?? [
      "The briefing is over. Now produce the SquadPlan from everything above: what the user asked for, their answers, and what you found in the repository. Answer only with the plan, as structured output.",
    ]),
  ].join("\n\n");
}

export function planFixPrompt(errors: readonly string[]): string {
  return `The plan has problems Gravita can't run with:\n${list(errors)}\n\nFix them and answer with the whole corrected plan.`;
}

function roleOwnsLine(r: PlanRole) {
  return `${r.name} (${r.id}): ${r.owns.join(", ")}`;
}

/** A role's charter: who it is, what it owns and how it works with Gravita and the others. */
export function roleCharter(plan: SquadPlan, role: PlanRole, worktree: string): string {
  const others = plan.roles.filter((r) => r.id !== role.id && r.kind !== "planner");
  return `You are ${role.name}, the ${role.kind} role of a Gravita squad: Claude Code agents that each own part of one repository and build this together:
${plan.goal}

Your worktree is ${worktree}; work only there. You own ${role.owns.join(", ")} and nothing else.
Other roles: ${others.length ? others.map(roleOwnsLine).join("; ") : "none"}.
Shared files (${plan.shared.paths.join(", ") || "none"}) belong to Gravita: it regenerates them after each merge.

How you work:
- Change only files inside what you own. For anything else, ask its owner with request_change (or post_note for information). A tool call outside your paths is refused.
- Gravita owns git: don't commit, push, merge, rebase, stash or switch branches. Read-only git (status, diff, log, show) is fine.
- Contracts (${plan.contracts.map((c) => c.path).join(", ") || "none"}) are frozen after the foundation: read them with read_contract; to change one, ask its owner with propose_contract_change.
- When the task is done and its acceptance criteria hold, call complete_task with a short summary, then end your turn. Gravita commits your work and merges it into the integration branch.
- If you can't go on (a decision only the user can make, or work another role must do first), call yield_blocked with the reason and end your turn.
- Use report_progress for milestones, in plain language. Use subagents for side quests if they help.

Your charter: ${role.charter || "(none given)"}`;
}

export interface TaskContext {
  plan: SquadPlan;
  task: PlanTask;
  brief: string;
  answers?: Record<string, string>;
  /** Notes other roles sent to this role (or to everyone). */
  notes: readonly { fromRole: string; text: string }[];
  /** Why earlier attempts went back: conflicts, red checks, violations. */
  feedback?: string;
  resumed?: boolean;
}

/** The first message of a role's session for one task. */
export function taskPrompt(c: TaskContext): string {
  const t = c.task;
  const parts = [
    `Your task: ${t.title} (${t.id})`,
    `What it gives the user: ${t.plainSummary}`,
    `Paths it changes:\n${list(t.writes)}`,
    `Done when:\n${list(t.acceptance)}`,
  ];
  if (t.dependsOn.length)
    parts.push(`Already merged before you start: ${t.dependsOn.join(", ")}. Build on that work.`);
  if (c.plan.contracts.length)
    parts.push(
      `Contracts:\n${list(c.plan.contracts.map((k) => `${k.path} (${k.kind}, owned by ${k.owner})`))}`,
    );
  const answers = Object.entries(c.answers ?? {});
  parts.push(
    `The user's brief: ${c.brief}${answers.length ? `\nTheir answers:\n${list(answers.map(([q, a]) => `${q} → ${a}`))}` : ""}`,
  );
  if (c.notes.length)
    parts.push(`Notes for you:\n${list(c.notes.map((n) => `from ${n.fromRole}: ${n.text}`))}`);
  if (c.feedback) parts.push(`Earlier attempts went back because:\n${c.feedback}`);
  if (c.resumed)
    parts.push("You were interrupted while working on this task. Continue where you left off.");
  parts.push("When it's done, call complete_task with a short summary, then end your turn.");
  return parts.join("\n\n");
}

export const NUDGE_PROMPT =
  "You ended your turn without calling complete_task. If the task is done, call complete_task now with a short summary. If you can't finish it, call yield_blocked with the reason. Then end your turn.";

export const CONTINUE_PROMPT =
  "You ran out of turns. Continue the task where you left off, and call complete_task (or yield_blocked) when you're done.";
