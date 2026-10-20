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

### Cursor — [v0.5.0-beta](https://github.com/WillDant/gravita/releases/tag/v0.5.0-beta)
Cursor as a third agent: start and steer Cursor chats through the `cursor-agent` you installed (ACP), with approvals, Agent/Plan/Ask modes and your account's models, or run it in Gravita's terminal with its chats on the map; a Cursor API key you paste into Gravita and keep in your macOS Keychain. Later: observing Cursor sessions you run elsewhere, and the conversation of a Cursor chat after it ends. See [cursor.md](cursor.md).

### Release notice — [v0.6.0-beta](https://github.com/WillDant/gravita/releases/tag/v0.6.0-beta)
Gravita tells you in the app when a newer release is out (one anonymous look at GitHub's public releases list, a notice with a link; nothing is installed by itself), and Settings gets theme, language and notification preferences.

### Window polish — [v0.7.0-beta](https://github.com/WillDant/gravita/releases/tag/v0.7.0-beta)
A transparent macOS title bar that takes the app's colour, and a quieter Home without the Cursor key line.

### Updates in Settings — [v0.7.1-beta](https://github.com/WillDant/gravita/releases/tag/v0.7.1-beta)
Settings shows the version you run, looks for a newer one and installs it by downloading and opening the release's installer.

### Quieter menu — [v0.7.2-beta](https://github.com/WillDant/gravita/releases/tag/v0.7.2-beta)
The menu's footer keeps only Settings and Notifications; theme and language live in Settings.

### Self-updating — [v0.8.0-beta](https://github.com/WillDant/gravita/releases/tag/v0.8.0-beta)
"Install" in Settings downloads the new version, checks its signature, replaces Gravita and opens it again.

### Form icons — [v0.8.2-beta](https://github.com/WillDant/gravita/releases/tag/v0.8.2-beta)
Icons on the New squad and New session forms and on the titles of Home and Settings.

### Terminais — [v0.9.0-beta](https://github.com/WillDant/gravita/releases/tag/v0.9.0-beta)
A New terminal button, a screen where terminals split side by side or stacked, and a Terminais list in the menu that shows the agent (Claude Code, Codex, Cursor Agent) running in each.

### Git in the session — [v0.10.0-beta](https://github.com/WillDant/gravita/releases/tag/v0.10.0-beta)
A button at the top right of a chat shows the branch and how many files changed, and opens a panel with the branch's pull request (state, checks, review) and the diff of every changed file.

### Files and context in the session — [v0.10.5-beta](https://github.com/WillDant/gravita/releases/tag/v0.10.5-beta)
A file explorer with editor tabs replaces the map on demand, and a header meter opens a panel with the context window broken down by category, MCP tools and memory files.

### Welcome and collapsible menu — [v0.10.7-beta](https://github.com/WillDant/gravita/releases/tag/v0.10.7-beta)
A new chat opens with a welcome and the agent's coloured logo, agent icons in terminals are coloured, and the menu folds into an icon rail you can choose.

## Next

### Polish and public launch
Replay with a scrubber, a full Portuguese pass, signed and notarized builds, the landing page, docs, an in-app tour and an accessibility audit.

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
