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
- Writes its own state only under `~/.gravita` (database, `runtime.json` with the port and a per-run hook token, mode 0600).
- Has a kill switch (tray, or `engine.stopAll`) that stops every session Gravita started. Sessions you run in a terminal are never touched.
- For OpenAI (planned), uses the official "Sign in with ChatGPT" program for open-source apps, or the Codex CLI's own login.

If you find Gravita doing anything on the first list, it's a bug: please report it as a security issue (see `SECURITY.md`).
