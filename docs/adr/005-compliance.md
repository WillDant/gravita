# 005 — Provider compliance

Status: accepted

## Decision
No third-party Claude login: Gravita runs the user's unmodified, already-logged-in Claude Code and never reads or stores Claude credentials (see `docs/COMPLIANCE.md`). OpenAI support uses the official "Sign in with ChatGPT" program for open-source apps or the Codex CLI's own login. No hosted or multi-user mode, no telemetry by default, nothing written under `~/.claude`.

## Consequences
The "log in with your account" experience for Claude is "Connect Claude Code": detect the CLI, and if needed open Claude Code's own `/login`. Usage still comes from the user's subscription or API key.
