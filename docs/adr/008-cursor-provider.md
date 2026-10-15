# 008 — Cursor as a third provider

Status: accepted

## Context
Users with a Cursor subscription asked to run Cursor's agent from Gravita next to Claude Code and Codex. Cursor offers three ways in: the `@cursor/sdk` package, Cloud Agents, and the `cursor-agent` CLI. Only the CLI runs locally, in the user's folder, with the user's rules and MCP servers, and only its `acp` command (Agent Client Protocol: newline-delimited JSON-RPC 2.0 on stdio) lets a client answer tool approvals, cancel a turn and switch mode and model while a session runs.

Claude Code and Codex use their CLI's own login, and Gravita never touches a credential (ADR 005, `COMPLIANCE.md`). Cursor's CLI can log in by itself too, but the user asked for one explicit source: a Cursor API key pasted into Gravita. That makes Cursor the first provider whose credential Gravita stores, so the exception is written down here before any code holds the key.

The spike (`spec/cursor-provider/tasks/T01-spike-acp-cursor-agent.md`, CLI `2026.10.14-0f9edde`) found:
- `cursor-agent acp` answers `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`, `session/set_mode`, `session/set_model`, streams `session/update` and asks `session/request_permission` with `allow_once | allow_always | reject_once` options.
- With `CURSOR_API_KEY` in its environment the CLI is authenticated; calling `authenticate {methodId: "cursor_login"}` without a credential starts a browser login and waits.
- The CLI's credential store follows `AGENT_CLI_CREDENTIAL_STORE` (`memory | file | default`, undocumented). With `memory`, a saved login in the Keychain is ignored (`session/new` answers "Authentication required") and nothing is written back.
- `cursor-agent models` is the cheapest check of a key: exit 0 with the models for a valid key, "The provided API key is invalid" for a bad one, "Failed to reach the Cursor API" offline.

## Decision
- **Transport.** Gravita runs the user's installed `cursor-agent acp`: one process per session, in its own process group (the kill switch, closing the chat and quitting stop it), in the chat's folder. Sessions are `cursor:<ACP session id>`; tool calls `cursor:<session>:<tool call>`. `@gravita/adapter-cursor` is process-free (ACP types, a client over adapter-codex's `JsonRpcConnection`, the mapper, the tool-call adapter, a scripted ACP server for tests); `CursorAcpRuntime` (engine infrastructure) owns the process. Gravita never calls `authenticate`; it opens with `initialize` then `session/new`, and declares no `fs` or `terminal` capability, so the agent reads and writes files and runs commands itself.
- **Modes.** Only Cursor's `agent | plan | ask`. There is no full access and no `--force`: every approval Cursor asks for waits in `PermissionBroker` for the user; Allow answers `allow_once`, Deny `reject_once`, a request that ends without the user `cancelled`. Gravita never picks `allow_always`. `session.settings` events carry modes in Claude Code's terms (`agent → default`, `plan → plan`, `ask → plan`) plus `providerMode` when that loses the mode (Cursor's `ask`).
- **Models.** "Auto" (Cursor's `default[]`) is the default; the session's `availableModels` list the rest.
- **Credential.** The only Cursor credential Gravita uses is the API key the user pastes in its settings:
  - the Tauri shell stores it in the macOS Keychain (service `dev.gravita.app.cursor-api-key`) and nowhere else, and never returns it to the web UI once saved;
  - the shell hands it to the engine over the engine's stdin, as one JSON line after the session token (`{"type":"cursorKey","value":…}`; `null` when removed). It never crosses the WebSocket, is never logged, and never appears in argv;
  - the engine keeps it in memory and injects it as `CURSOR_API_KEY` only into the environment of the `cursor-agent` processes it starts. That environment is built from scratch: the login-shell allowlist with no `CURSOR_*` or `AGENT_CLI_*` variable inherited (no `CURSOR_AUTH_TOKEN`, which the CLI would prefer to the key; no `CURSOR_API_ENDPOINT`, which would send the key elsewhere), plus `AGENT_CLI_CREDENTIAL_STORE=memory` (the saved login is neither read nor overwritten) and `NO_OPEN_BROWSER=1`;
  - the exact key is replaced by `••••` in every text that becomes an event (messages, thinking, tool previews, errors);
  - no fallback: a `CURSOR_API_KEY` from the user's shell and a saved `cursor-agent login` are never used. Without a key the provider reads "key not configured" and `session.start` fails with `notLoggedIn` before any process starts;
  - `cursorKey.validate` runs `cursor-agent models` with that environment and reports `valid`, `invalid` or `unchecked` (offline). A session whose `session/new` fails runs the same check, so a bad key reads as `invalid` rather than a crash.
- **Optional, like Codex.** Without `cursor-agent` (or older than 2026.10.14) the provider shows a note and Claude Code and Codex work as before.

## Out of scope
Squads on Cursor (dropped), observing Cursor chats of the editor, the Conversation lens for Cursor sessions. `allowedProviders` never offers Cursor and `validatePlan` refuses it.

## Alternatives rejected
- `@cursor/sdk`, `cursor-agent -p --output-format stream-json`, Cloud Agents: no approvals in the loop (or not local).
- Keeping the key in a file, in Gravita's database, or in the webview's storage; sending it over the WebSocket; passing `--api-key` on the command line (visible in `ps`).
- Falling back to the shell's `CURSOR_API_KEY` or the CLI's saved login: two hidden sources would make "remove key" a lie.
- A temporary `HOME` per process as isolation: it breaks `~/.cursor` (rules, MCP, session resume), git and SSH, and the Keychain doesn't follow `HOME` anyway.

## Consequences
- Gravita now stores one credential. Each promise above has a test: the env builder (`cursor-environment.test.ts`), the stdin channel (`main` stdin tests), the masking (`sentinel-key` fixture), the contract (no RPC method takes or returns a key), the compliance test (`cursor-compliance.test.ts`) and the Rust Keychain wrapper's tests.
- `AGENT_CLI_CREDENTIAL_STORE` is internal to the CLI and may change (risk R17): the minimum version is pinned and the compliance test checks the environment Gravita builds; a CLI that stops honouring it must block Cursor sessions rather than fall back.
- ACP has no steer, no per-subagent stop, no questions Gravita can answer and no usage: a message sent during a turn waits for it, `stopAgent` stops only the main agent, Cursor's own questions are declined, and Cursor sessions report no cost.
- Whether the agent's shell tools see `CURSOR_API_KEY` is still to be confirmed with a real key; the masking covers it meanwhile.

**Amendment (embedded terminal).** The D6 exception covers a Cursor terminal too: `cursor-agent` opened in the embedded terminal gets the same environment as a chat (no inherited `CURSOR_*`/`AGENT_CLI_*`, `CURSOR_API_KEY` from the app, in-memory credential store, no browser login), but not `GRAVITA_MANAGED`. Without a key the terminal does not open. No other terminal (shell, Claude Code, Codex) ever receives the key. The PTY output is not scanned for the key: the process receives it only as an environment variable and Gravita never types it.

**Amendment (observing terminal chats).** The engine reads the Cursor home (`--cursor-home`, default `~/.cursor`) read-only, and only `projects/*/agent-transcripts/<chat>/<chat>.jsonl` and `chats/*/<chat>/meta.json`, to put the `cursor-agent` chats of the embedded terminal (and their subagents) on the map. It never opens the login, `cli-config.json`, `mcp-auth.json`, `acp-sessions/` or the SQLite stores, and follows no symlinks; `cursor-compliance.test.ts` and the discovery test audit the paths. A transcript holds text and tool calls, no results, ids or times, so Gravita makes those up from the file (ids from the line, a call completes when the agent moves on, times from the file's modification time). A subagent is a transcript of its own with no link to its parent: it is tied to the `Task` call whose prompt is its first message. The CLI's chats are told from the editor's by their `meta.json`.
