# Security

Please report vulnerabilities privately through GitHub Security Advisories on this repository rather than in public issues.

Gravita runs a local engine on `127.0.0.1` with a per-launch token and reads Claude Code transcripts read-only. Anything that exposes that engine beyond the local user, reads credentials, or writes under `~/.claude` is a security bug (see `docs/COMPLIANCE.md`).
