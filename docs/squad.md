# Squads

A squad is a small team of Claude Code agents that builds something together in one repository. Each agent has a role (for example backend, frontend, tests) and owns its own part of the code, so the agents can work at the same time without overwriting each other. You describe what you want, review a plan, and Gravita runs the team and hands you the result.

Squads use the Claude Code you installed, with your own login. Nothing changes in your repository until you approve the plan.

## How a squad works

1. **Brief.** Pick a folder (an empty one, or a git repository with no uncommitted changes), say what you want, set a budget and how much the squad may do without asking you (see [Autonomy](#autonomy)). Then talk it through with the planner: it looks around your repository (it can't change anything), asks you a few short questions (often as choices) and says what it assumes. It doesn't plan yet; it tells you when it knows enough. When you're ready, ask for the plan.
2. **Plan.** The planner, in the same conversation, so it keeps everything you told it, proposes a plan: the roles and the folders each one owns, the tasks in plain language, the checks that will run (shown as the exact commands), what it assumed, and questions for you. Gravita checks the plan; if something doesn't add up (two roles owning the same folder, a task writing outside its role's folders…) the planner fixes it, up to three times. You can ask for a new plan with feedback.
3. **Approve.** You answer the planner's questions and approve. An empty folder becomes a git repository at this point.
4. **Foundation.** The tasks that set up the project and its shared interfaces (an API description, shared types) run first. Those interfaces are then frozen, so every role builds against the same thing.
5. **Build.** Roles work in parallel, one task at a time each, at most three at once. When an agent finishes a task, Gravita checks that it only changed its own folders, commits the work and merges it into the squad's integration branch, running the plan's checks. Roles can leave notes for each other, ask another role for a change, or report a bug in someone else's folder; those become tasks for the owner.
6. **Verify.** When every task is done, the plan's final checks run on the integration branch. If they fail, the owners of the files involved get tasks to fix them.
7. **Deliver.** You choose what happens to the work (see [Delivery](#delivery)).

You can pause, resume or stop a squad at any time. Anything that needs you (a permission, a question, a task an agent couldn't finish, a used-up budget) shows up in **Needs you**.

## What it costs

Every agent in a squad is a Claude Code session on your account, so a squad uses your plan (or spends) like that many sessions. Before you approve, the Board shows a rough estimate for the plan in dollars, split by model; on a subscription that is what the same work would cost on the API, a way to compare plans rather than a bill. Real use depends on your repository and on how many tries a task needs.

**Which models run.** You choose when you start the squad:

- **Automatic (recommended).** Sonnet for most work, Opus where it matters, Haiku for helpers; it steps up only when a task struggles. In detail:
  - the briefing conversation runs on Sonnet;
  - writing the plan runs on Opus (one run, and the one that shapes everything after it);
  - tasks run on Sonnet, except foundation tasks, tasks that write a shared contract, and large tasks, which run on Opus (the Board marks them "Opus");
  - a task that struggled (it failed, its merge conflicted or was undone by a red check, it was sent back too often, or it ended without finishing) runs its next try one step up: Haiku → Sonnet → Opus. Being paused, asking you a question or running out of budget doesn't count;
  - the helpers agents start on their own (Explore and other subagents) run on Haiku, unless the agent asks for a specific model.
- **Opus everywhere.** The strongest model for every agent; costs the most.
- **Sonnet everywhere.** About half of Opus's price per task, for every agent, with no step up.

Whatever you choose, a model the plan sets for a role wins for that role, and "Retry with Opus" on a stuck task wins for that task.

### Budgets

Most people run Claude Code on a subscription (Pro, Max, Team) with usage limits: a 5-hour window and a weekly limit. So a squad's budget is a **share of your plan**: "use at most **20%** of my **weekly limit**" (or of the **5-hour window**). The new-squad panel shows how much of that window your account has used and when it resets ("Weekly: 34% used · resets Fri 9:00 AM").

- **What counts.** Plan usage is account-wide: your own Claude Code sessions, claude.ai and (for Codex) ChatGPT move it too, and Gravita can't tell them apart. So a squad counts what the window moved **since it started building**: Gravita records where the window stood when you approved the plan (the baseline) and measures the change from there. Other use of the same account while the squad works counts against its share; the squad's header says so. Time the squad stands paused doesn't count: resuming starts the count again from where the window is then.
- **A window that resets mid-squad.** What the squad had used is carried over, and the new window counts from 0. The share never goes down.
- **Several providers.** Each provider's window is counted on its own, and the more consumed one is the squad's share.
- **Warn and stop.** At 75% of the share you're warned; at 100% the running sessions are stopped within a few seconds and the squad pauses. Resume it with a bigger share to go on. Until the first reading arrives the meter says "measuring…" and nothing is paused.
- **Where the numbers come from.** Claude Code tells Gravita when your plan's usage changes, and Gravita also reads it through a session that is already running: when the squad starts, every few minutes while it works, and when you open a chat or squad screen (at most once a minute). It never starts a session just to read usage. The reading uses an experimental part of the Agent SDK; if it stops working, Gravita relies on what Claude Code reports by itself and on the last values it knows.
- **Safety cap.** Each session still gets a dollar cap, but only as a net for a runaway session between two readings: several times its estimate (at least $5), never your budget.

**API key accounts.** An account without plan limits (an API key, Bedrock, Vertex) pays per token, so its budget is in **dollars**, a hard ceiling enforced in layers:

- Each session gets its own limit (its task's share of the budget, and never more than an equal share of what's left while several work at once). Claude Code stops a session that reaches it. The briefing conversation has its own small share (a twentieth, at least $0.50), and planning another (a tenth, at least $1).
- Gravita adds up what every session spent after each of their turns. At 75% of the squad's budget (or of a role's, if the plan sets one) you're warned. At 100% the running sessions are stopped within a few seconds and the squad pauses.
- To go on, resume the squad with a higher budget.

If you ask for a share of the plan on an API-key account, Gravita refuses the squad and asks for a dollar budget instead. Squads created before plan budgets keep their dollar budgets.

**For scale:** in Gravita's own end-to-end run on 2026-10-13, a squad built a small todo app from an empty folder (a pnpm workspace with a Hono API, a React + Vite page and Vitest tests: 3 roles, 4 tasks) in under 3 minutes for about **$1.06** on Automatic, with every task done on its first try, the build and tests green, and no file changed outside its role. Your repository, your goal and how many tries a task needs will change the number; the Board's estimate before you approve is the figure to go by.

On a subscription, dollar amounts (the estimate, what each role spent) are what the same work would cost on the API; what you actually use is the share of your plan.

## Autonomy

- **Ask:** every action other than reading goes to you.
- **Guarded:** agents edit files and run local commands on their own; anything that reaches the network or installs packages (`curl`, `npm install`, `pnpm add`, web fetches…) asks you first.
- **Autonomous:** agents don't ask, except when they have a question for you.

Whatever you choose, a role can never edit another role's folders, the shared files (lockfiles, the root `package.json`, CI config), or anything outside its own copy of the repository, and it can't commit, push, merge or switch branches: Gravita does all of that.

Squad agents also don't inherit your personal Claude Code setup. They load the repository's own `CLAUDE.md` and project settings, but not your user settings, MCP servers, plugins or skills: an autonomous agent shouldn't hold tools like sending messages on your behalf, and carrying a large personal setup into every call multiplies the cost. Chats you start in Gravita are your own Claude Code and keep all of it.

## What Gravita does to your repository

- **An empty folder** becomes a git repository on `main` with one first commit (a `.gitignore`), when you approve the plan.
- **An existing repository** must have no uncommitted changes when the squad starts; Gravita never stashes or commits anything of yours.
- **Worktrees.** Each role, and the integration branch, gets its own git worktree under `~/.gravita/worktrees/<project>/<squad>/`. Agents work there, never in your checkout. Gravita removes them after delivery; stopping a squad keeps them.
- **Branches.** The squad's work lives on branches named `gravita/<squad>/<role>` and `gravita/<squad>/integration` in your repository. They stay after delivery, so nothing is lost.
- **Commits** are made by Gravita (author "Gravita", with the role as co-author), never by the agents. Git hooks don't run for them.
- **Nothing is pushed** unless you choose to open a pull request.

## Delivery

- **Merge into my branch:** merges the integration branch into the branch the squad started from, in your own checkout. That branch must be checked out and clean.
- **Open a pull request:** pushes the integration branch and opens a pull request with the GitHub CLI (`gh`, installed and logged in). Only this option pushes anything.
- **Leave it on a branch:** nothing changes; the work stays on `gravita/<squad>/integration` for you to look at, merge or delete.

## If something goes wrong

- **A task fails.** Gravita retries once on its own (with what went wrong in the agent's instructions, and under Automatic on a stronger model); after that the task waits for you: retry it (optionally with another model), skip it, or give it to another role that owns its folders.
- **You pause, or press the kill switch in the tray.** Running sessions stop and the squad waits; when you resume, each interrupted task continues in its own session.
- **Gravita (or your computer) restarts during the brief.** The conversation so far is kept, but you can't write to the planner any more. Ask for the plan: a new planner session gets your brief and a summary of the conversation.
- **Gravita (or your computer) restarts.** Squads that were working come back paused, so nothing spends money until you resume. A task that was interrupted before the restart starts over from its last committed state, so changes it hadn't committed yet may be lost.
