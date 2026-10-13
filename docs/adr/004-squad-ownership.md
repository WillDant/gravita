# 004 — Squads: one session per task, worktrees, and enforced ownership

Status: proposed (milestone M2)

## Decision
Gravita orchestrates a Squad as separate Agent SDK sessions, one per task, each role in its own git worktree and branch. A validated `SquadPlan` assigns disjoint path prefixes to roles. Ownership is enforced in three layers: an in-process PreToolUse hook (friendly denial), the permission callback (real approvals), and a commit gate where Gravita diffs the role branch and rejects out-of-scope files. Gravita makes the commits and merges continuously into an integration branch; shared files (lockfiles, root manifest, CI) belong to Gravita and are regenerated, never merged as text. Agents share context through a per-session MCP server bound to their role.

## Consequences
Parallel agents can't overwrite each other; plans are reviewable before any money is spent; each task has its own budget and retry. More moving parts than a single lead session, which remains available as "crew templates" in plain chats.
