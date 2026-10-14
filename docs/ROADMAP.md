# Roadmap

Gravita grows in milestones, each named for what it gives you. A milestone ships as a release; large milestones arrive in several steps, each its own pull request ("Squads · step 3 of 5: orchestrator on the Agent SDK").

## Done

### Live observability
See every Claude Code session and subagent, across projects, as they work: the line map, the "Needs you" list, the agent panel, read-only from Claude Code's own transcripts and session registry.

### Chats and the desktop shell — [v0.1.0-alpha](https://github.com/WillDant/gravita/releases/tag/v0.1.0-alpha)
Start and steer Claude Code chats from Gravita through the official Agent SDK (approvals, questions, interrupt, model and mode); the Orbit lens; the tray with a kill switch; notifications; the optional Deep Observe plugin.

### Squads — [v0.2.0-beta](https://github.com/WillDant/gravita/releases/tag/v0.2.0-beta)
A team of role agents builds a goal in parallel git worktrees: a briefing conversation, a plan you approve, enforced path ownership, a merge queue with checks, budgets, and delivery by merge, pull request or branch. Automatic model choice for cost-benefit.

### Codex support — [v0.3.0-beta](https://github.com/WillDant/gravita/releases/tag/v0.3.0-beta)
OpenAI's Codex alongside Claude Code: observe Codex sessions, start and steer Codex chats with your own Codex login, squads whose roles run on Claude Code, Codex or both (with a Gravita profile of Codex you sign in to once), and budgets in plan usage for both providers.

### Terminal and conversation — [v0.4.0-beta](https://github.com/WillDant/gravita/releases/tag/v0.4.0-beta)
Run Claude Code, Codex or your shell in a terminal inside Gravita, with the map beside it; resume a finished session in one. A chat-like composer, a live line saying what the agent is doing, and tool calls folded between messages.

## Next

### Polish and public launch
Replay with a scrubber, a full Portuguese pass, signed and notarized builds, an updater, the landing page, docs, an in-app tour and an accessibility audit.

## Earlier milestone codes

Older branches, commits and planning notes used short codes. They map to the names above:

| Code | Milestone |
|---|---|
| M0 | Live observability |
| M1 (M1a–M1d) | Chats and the desktop shell |
| M2 (M2a–M2e) | Squads |
| M3 | Codex support |
| M4 | Polish and public launch |

New work never uses these codes; see "Naming" in [CONTRIBUTING.md](../CONTRIBUTING.md).
