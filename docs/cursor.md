# Cursor in Gravita

Gravita can run [Cursor](https://cursor.com)'s coding agent next to Claude Code and Codex: you start and steer Cursor chats from the new-session panel. It runs the Cursor CLI you installed (`cursor-agent`), in its ACP server mode, with a Cursor API key you paste into Gravita. Cursor is optional: without its CLI, Claude Code and Codex work as before.

## What works

- **Cursor chats.** In the new-session panel, choose Cursor (the choice appears when more than one agent can run; with only Cursor, chats start on Cursor). A chat streams Cursor's replies and tool calls on the map, takes follow-up messages and can be interrupted. A message sent while Cursor is working waits for the turn to end, then runs.
- **Approvals.** When Cursor wants to run a command or change files, Gravita shows the request; Allow and Deny answer Cursor for that one call. Gravita never answers "always".
- **Modes and models.** See below; both can be changed during a chat.
- **The kill switch** (tray, or `engine.stopAll`) stops Cursor chats too, and they count toward the six chats Gravita runs at once.

Not yet: Cursor in a terminal inside Gravita, Cursor roles in squads, observing Cursor sessions you run elsewhere (the editor, your own terminal), resuming a Cursor chat after Gravita restarts, plan usage for Cursor accounts, and answering Cursor's own questions (only approvals).

## Requirements

- The Cursor CLI, 2026.10.14 or later. Install it with `curl https://cursor.com/install -fsS | bash` (it goes in `~/.local/bin`); update it with `cursor-agent update`.
- A Cursor API key set in Gravita (below). Gravita shows the CLI's state and the key's state on Home, and a missing or outdated CLI as a quiet note, never a banner.

## The API key

Create a key in the Cursor dashboard, under Integrations. In Gravita, open **Settings** in the sidebar, paste the key under **Cursor**, and save. The key:

- is stored only in your macOS Keychain (service `dev.gravita.app.cursor-api-key`), and is never shown again: the panel shows only its state;
- is handed by the desktop shell to the engine through the engine's standard input, kept in memory, and given only to the `cursor-agent` processes Gravita starts, as `CURSOR_API_KEY` in their environment;
- is the only Cursor credential Gravita uses. A `CURSOR_API_KEY` in your shell and a saved `cursor-agent login` are never used: without a key in Gravita, Cursor chats don't start.

Its states: **not set**, **not checked yet** (just saved), **working** (Cursor accepted it) and **turned down** (Cursor refused it: replace it). Gravita checks a new key at once with `cursor-agent models`, and you can check it again with "Check the key". "Remove" deletes it from the Keychain after a confirmation.

The key can only be set in the desktop app; the engine running with Vite in a browser has no key, so Cursor stays "not set" there.

## Modes

| In Gravita | What Cursor does |
| --- | --- |
| Agent | Works on the task, asking before running commands or changing files |
| Plan first | Plans before changing anything |
| Ask (read only) | Answers questions without changing files |

There is no full-access mode: Gravita never runs Cursor with `--force`.

## Models

"Auto" is the default (Cursor picks the model). The list is your account's own, read from `cursor-agent` when a chat starts; changing the model applies from the next turn.

## Compliance

See [What Gravita never does › Cursor API key](COMPLIANCE.md#cursor-api-key-exception) and [ADR 008](adr/008-cursor-provider.md).

## Manual test

Run this with each new version of the Cursor CLI, before raising the minimum version:

1. Note the state of your own Cursor login: `security find-generic-password -s cursor-access-token` (and `-s cursor-api-key`), and `stat -f %m ~/.cursor/auth.json` if that file exists.
2. `pnpm --filter @gravita/desktop tauri dev`. On Home, "Add the key", paste a key, and check that the state turns to "working". Accept the Keychain prompt if macOS shows one, and check the item in Keychain Access.
3. Start a Cursor chat in Agent mode that runs a command: allow it, then deny an edit, switch to Ask and to another model, interrupt a long command.
4. Quit and reopen Gravita: the key is still set. Replace it with a wrong one: "turned down". Remove it: "not set", and starting a Cursor chat shows a notice with a link to Settings, even with `CURSOR_API_KEY` exported in your shell.
5. Repeat step 1: your own Cursor login is unchanged.

## For contributors

- `packages/adapter-cursor`: the ACP client (JSON-RPC over stdio), the mapper from ACP updates to Gravita events (with the key masked), and the tool names Gravita's guard knows.
- `apps/engine/src/infrastructure/cursor`: detection, the environment built from scratch, the key check, and `CursorAcpRuntime` (one `cursor-agent acp` per chat).
- `apps/engine/src/application/services/cursor-key-status.ts`: the key's state in the engine status.
- `apps/desktop/src-tauri/src/cursor_key.rs`: the Keychain and the stdin hand-off; `apps/desktop/src/features/settings/Settings.tsx` and `CursorKey.tsx`: Settings and the key panel.
- Fixtures: `fixtures/cursor-acp/2026.10.14/` (synthetic, modelled on the CLI's protocol); the live probe is `tools/spikes/cursor-acp-probe.ts`.
