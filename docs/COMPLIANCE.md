# What Gravita never does

Gravita runs on your machine and works with the coding agents you already use. To keep your accounts safe and to stay within each provider's terms, it never:

- **Offers a "Sign in with Claude" button**, or any OAuth flow of its own for Anthropic. Anthropic doesn't allow third-party apps to offer Claude.ai login or to route requests through your Free/Pro/Max credentials ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)).
- **Reads, stores or forwards Claude credentials.** It doesn't open `~/.claude/.credentials*`, `~/.claude/sessions/*.key`, credential-bearing transcript records, or Claude Code's messaging sockets. Tests enforce this.
- **Bundles or modifies Claude Code.** Gravita starts the `claude` you installed (`pathToClaudeCodeExecutable`), unmodified. You log in through Claude Code's own `/login`, or bring an API key / Bedrock / Vertex setup.
- **Spoofs Claude Code's identity** (user agent, entrypoint, headers).
- **Shares one subscription between people or hosts agents for others.** There is no hosted or multi-user mode.
- **Writes anything under `~/.claude`.** Observing sessions is read-only.
- **Sends telemetry by default.**

What it does:

- Reads Claude Code transcripts under `~/.claude/projects` (read-only) to show you your sessions and subagents.
- Starts Claude Code through the official Agent SDK for sessions you start in Gravita, so usage comes from your own account.
- Offers an optional Claude Code plugin, [Deep Observe](deep-observe.md), that you install yourself through Claude Code's own `/plugin` flow (Gravita never installs it or edits Claude Code's settings). Its hooks only observe: they run async, print nothing, always exit 0, and send each hook's JSON to Gravita on 127.0.0.1 (or to `~/.gravita/spool` while Gravita is closed). They never allow, deny or change anything; you still answer every permission dialog in Claude Code.
- Looks for a newer Gravita release: a few seconds after start and every six hours the engine makes one anonymous request to GitHub's public API for the releases list of `WillDant/gravita` (no token and no account; it sends `gravita/<version>` as its user agent and nothing about you or your projects). If a newer one is out, the app shows a small notice with a link to its page; it never downloads or installs anything. This is not telemetry: nothing about you is sent, and the answer only travels to the app. It runs in real mode only (never in the demo).
- Installs an update only when you press "Install" in Settings (or "Check for updates" to look right away, the same anonymous request as above): the engine then downloads the `.dmg` of that release from `github.com/WillDant/gravita/releases/download/…` (the link comes from GitHub's list, never from the app's window), checks its size and SHA-256 against the digest GitHub reports, and only then opens it with macOS; a file that doesn't match is deleted. You still drag Gravita to Applications yourself: nothing is replaced or restarted by itself.
- Writes its own state only under `~/.gravita` (database, `runtime.json` with the port and a per-run hook token, mode 0600).
- Runs a [squad](squad.md)'s team only after you approve its plan (before that only a read-only planner runs). A squad works in git worktrees under `~/.gravita/worktrees` and on branches named `gravita/<squad>/*` in your repository; Gravita makes its commits there (git hooks off, your git config never written), touches your own branch only when you choose to merge the result into it, and pushes only when you choose to open a pull request. It turns an empty folder into a repository, but never stashes or commits anything of yours in an existing one.
- Has a kill switch (tray, or `engine.stopAll`) that stops every session Gravita started. Sessions you run in a terminal are never touched, including terminals open inside Gravita.
- Opens [terminals](adr/007-embedded-terminal.md) inside the app when you ask for one: your login shell, or your own `claude`, `codex` or `cursor-agent` started through it (Cursor only with the key pasted in Gravita, as for its chats), in the folder you chose and with the same environment they get in your own terminal. Gravita never adds anything to mark these sessions as its own, never types for you after the first message you wrote, and keeps what they print only in memory (the newest 1 MB per terminal) until you close the terminal. Closing it, or quitting Gravita, ends its processes.
- For Codex, relies on the Codex CLI's own login (`codex login`, run by you in a terminal); Gravita never logs anyone in for a chat. Squads run Codex in a profile of Gravita's own that you sign in to once, through Codex's own sign-in (see below).

## Codex

Gravita observes Codex the same way it observes Claude Code: from the files Codex writes for itself, read-only. Codex chats you start in Gravita run your own `codex`, with your own login.

It never:

- **Reads Codex credentials or secrets.** It doesn't open `~/.codex/auth.json`, `config.toml` (which can hold MCP server tokens), the SQLite state (`state_*.sqlite`, `thread_history_*.sqlite`, `sqlite/`), `history.jsonl` (your past prompts), logs, or anything else in the Codex home outside `sessions/`.
- **Reads archived sessions** (`archived_sessions/`), or follows a symbolic link out of `sessions/`.
- **Writes anything under `~/.codex` itself.** Observing is read-only. A chat you start is Codex's own session: Codex writes its rollout there, as it does for any session you run. Squads never use `~/.codex` at all.
- **Handles Codex tokens, or logs you in to your own Codex.** It never runs `codex login`, never calls the app-server's login methods on your Codex home, and never sees a token: Codex keeps its credentials and uses them itself. The one sign-in Gravita starts is for its own Codex profile for squads, and Codex runs it (below).
- **Reads its own Codex profile's login.** In `~/.gravita/codex-home` Gravita writes only its `config.toml`, and reads only that and the squads' rollouts under `sessions/` (for the Conversation lens); the login Codex stores there is Codex's.
- **Keeps your account's identity.** Codex's account read also returns your email and account id; Gravita keeps only the kind of login (ChatGPT or API key) and the plan type.

What it does:

- Lists the date folders under `~/.codex/sessions` (or the `--codex-home` you pass) and reads the `rollout-*.jsonl` files there, read-only, to show your Codex sessions and their subagents live. Recent folders are checked every few seconds and older ones every few minutes (a resumed session keeps writing to its old file). Compressed rollouts (`.jsonl.zst`) are read when the runtime can decompress them, and skipped otherwise.
- Keeps only previews of what it reads (240 characters at most) in its own database; the Conversation lens reads full message text from the rollout when you open a session, and stores none of it.
- Leaves out the threads Codex runs for itself, such as the guardian that reviews approvals: they repeat their parent's context and aren't agents you started.
- Runs `codex --version` to show whether Codex is installed and recent enough (0.160.0 or later).
- For a chat you start, runs `codex app-server` (your installed `codex`, unmodified) in the chat's folder, in a process group of its own that the kill switch, closing the chat or quitting Gravita stops. It gets your login shell's environment reduced to an allowlist (`PATH`, `HOME`, locale, proxies, `OPENAI_*`, `CODEX_*`, `AWS_*`; never another tool's secrets, and never the sandbox variables of a Codex that Gravita itself may run inside), and your own `CODEX_HOME`. It identifies itself as `gravita` in the app-server's `clientInfo`. Every approval Codex asks for waits for your answer in Gravita.
- To show whether Codex is logged in and how much of your plan is used, starts a short-lived `codex app-server` that only does the handshake and reads the account, the plan windows and the model list, then exits: no thread, no turn, nothing spent. It runs at start-up and when a screen asks for plan usage, at most once a minute; while a chat runs, its own app-server answers instead.
- **For squads, keeps a Codex home of its own**, `~/.gravita/codex-home` (owner-only), so squad agents never inherit your Codex setup (MCP servers, hooks, plugins). It creates the folder and writes only `config.toml` there (no MCP servers, hooks and other personal features off). You sign in to it once: Gravita starts `codex app-server` on that home and calls `account/login/start {type: "chatgpt"}`; Codex answers with OpenAI's sign-in link, which Gravita opens in your browser (only `https` links on `openai.com`/`chatgpt.com`), and Codex takes the callback and stores the login there. Gravita keeps only the kind of login and the plan type. Each squad session runs your `codex app-server` on that home, in the role's worktree, sandboxed to it, with the same environment allowlist minus `CODEX_*` and `OPENAI_API_KEY`, and with Gravita's role tools added for that process only, as an MCP server on 127.0.0.1 that answers only that session's random token and refuses browsers.

Tests enforce this: a Codex home with decoy `auth.json`, `config.toml`, `state_5.sqlite`, `history.jsonl`, an archived rollout and a link to the credentials is observed through an audited file system, and every path touched must be under `sessions/`; the home must be byte-for-byte and mtime-for-mtime unchanged afterwards, including after a real engine ran on it (`apps/engine/test/infrastructure/codex-compliance.test.ts`).

## Cursor API key (exception)

Cursor is the one provider whose credential Gravita stores, because you give it one ([ADR 008](adr/008-cursor-provider.md)). If you paste a Cursor API key into Gravita, it is stored only in your macOS Keychain, never written to Gravita's database, logs or files, never shown again in the UI, never sent anywhere except as `CURSOR_API_KEY` in the environment of the `cursor-agent` processes Gravita starts for you, and masked in any agent output Gravita records. "Remove key" deletes it from the Keychain. This key is the only Cursor credential Gravita uses: it never forwards a `CURSOR_API_KEY` from your shell, never relies on a saved `cursor-agent login`, and runs `cursor-agent` so that it neither reads nor overwrites your saved Cursor login. Without a key, Cursor sessions don't start. Claude and Codex credentials are still never read, stored or forwarded.

It never:

- **Sends the key over the app's WebSocket, logs it, or puts it on a command line.** The desktop shell hands it to the engine through the engine's standard input, and the engine keeps it in memory.
- **Passes your shell's Cursor variables to `cursor-agent`.** Its environment is your login shell's allowlist (`PATH`, `HOME`, locale, proxies) with no `CURSOR_*` or `AGENT_CLI_*` variable, plus the key, `AGENT_CLI_CREDENTIAL_STORE=memory` (the CLI keeps its tokens in memory only) and `NO_OPEN_BROWSER=1`.
- **Logs you in to Cursor.** It never runs `cursor-agent login` or the ACP `authenticate` method.
- **Offers Cursor full access.** Cursor chats run in Agent, Plan or Ask mode, and every approval Cursor asks for waits for your answer in Gravita.
- **Reads your Cursor login or settings.** Under `~/.cursor` it reads only two things, and only to show the Cursor CLI chats you run in a Gravita terminal on the map: each chat's transcript (`projects/*/agent-transcripts/`) and its `chats/*/*/meta.json` (folder, title, start time). Never your saved login, `cli-config.json`, `mcp-auth.json`, `acp-sessions/` or the chat databases; it never writes there, and never follows symlinks. A transcript without a `meta.json` (the editor keeps none) is ignored.
- **Lets the web UI read the key back.** The UI can only store, replace or remove it and ask whether one is set; the engine reports the key's state (missing, unchecked, valid, invalid), never its value.

What it does:

- Runs `cursor-agent --version` to show whether the Cursor CLI is installed and recent enough (2026.10.14 or later), and `cursor-agent models` with the environment above to check the key: when a key is set or replaced, when the status is read, and when you press "Check the key".
- For a chat you start, runs `cursor-agent acp` (your installed CLI, unmodified) in the chat's folder, in a process group of its own that the kill switch, closing the chat or quitting Gravita stops. It identifies itself as `gravita` in the protocol's `clientInfo`.

Tests enforce this: the environment builder (decoy `CURSOR_*`, `AGENT_CLI_*` and `OPENAI_*` variables in the shell never reach `cursor-agent`), the key only in the environment and never on a command line, the stdin channel, no session and no process without a key, masking of a sentinel key in every event, the database, the status, the snapshot and the logs of a scripted session, no RPC method that takes or returns a key, no code path that logs in, calls `authenticate` or opens `~/.cursor`, and the Keychain wrapper (`apps/engine/test/infrastructure/cursor-compliance.test.ts`, `cursor-chat.test.ts`, `cursor-provider.test.ts` and the desktop shell's Rust tests).

If you find Gravita doing anything on the first list, it's a bug: please report it as a security issue (see `SECURITY.md`).
