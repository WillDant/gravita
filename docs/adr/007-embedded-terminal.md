# 007 — Embedded terminals in the engine

Status: accepted

## Context
Many users would rather drive Claude Code or Codex in a terminal than in a chat box, and people new to the terminal shouldn't need a separate app. Gravita already observes any `claude` or `codex` session from the files they write. So a terminal inside Gravita, with the map beside it, gives both groups one place to work, and the observation pipeline needs no changes.

## Decision
- **The PTY lives in the engine**, through Bun's own pseudo-terminals (`Bun.spawn` with `terminal`). There's no native addon, so it compiles into the sidecar. The Rust shell stays minimal (ADR 001), and the webview still has no shell or file-system capability (ADR 002): it reaches terminals only through the authenticated WebSocket.
- **There's no free-form command.** `terminal.spawn` takes `shell | claude | codex` and a folder, validated like a chat's. `shell` starts the user's login shell. `claude` and `codex` start the user's own CLI through that login shell (`$SHELL -lic 'exec "$@"'`), so the CLI sees exactly the environment it gets in the user's own terminal.
- **A terminal session is an external session.** It isn't registered as a Gravita runtime, so transcripts, rollouts and Deep Observe hooks report it as they do for any terminal. `GRAVITA_MANAGED` is never set, and the start environment is the allowlisted login environment (no host-scoped Claude Code or Codex variables), plus `TERM`, `COLORTERM` and `TERM_PROGRAM=Gravita`.
- **Linking a terminal to its session.**
  - A new Claude Code session takes its id from Gravita (`--session-id`), so it is linked from the start.
  - Codex has no such flag, and a shell runs whatever the user types. For those, the first external session that starts in the terminal's folder after it opened, from a matching provider, becomes its session.
- **Output is not an event.** It streams as `terminal.output` notifications in batches of about 16 ms and is never stored. The newest 1 MB of each terminal is kept in memory for `terminal.attach`, so a reloaded UI sees what was printed.
- **Lifetime.** Terminals belong to the user, like the ones in their own terminal app: the kill switch leaves them alone. Closing a terminal hangs up its process group, then kills it 2 s later; quitting Gravita does the same for all of them. There are at most 8 at once.
- **No Windows yet.** Bun's PTY is POSIX only. The engine reports `terminal: false` in its status, and the UI hides terminals.

## Consequences
- The user's MCP servers, plugins and skills load in terminal sessions, as they do in their own terminal: the user typed the command. Squads still never load them.
- Matching by folder can claim the wrong session when the same folder also has a session started outside Gravita, in the seconds after a shell or Codex terminal opens. The cost is one misplaced link, which the user can see.
- Login stays the CLI's own: `/login` or `codex login` typed by the user in the terminal. Gravita sees only the characters on the screen.
