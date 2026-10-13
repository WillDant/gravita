# 001 — Engine as a Bun-compiled TypeScript sidecar

Status: accepted (pending spike G1/G2 on signing and size)

## Context
Gravita must drive Claude Code through its official control surface (hooks, permission callbacks, in-process MCP, subagent definitions). That surface is the Claude Agent SDK, which ships for TypeScript and Python. The control protocol under it is undocumented and changes with the CLI.

## Decision
All domain logic lives in a TypeScript engine (`apps/engine`), compiled with `bun build --compile` and bundled as a Tauri `externalBin`. The Rust shell stays minimal: window, tray, notifications, and the sidecar's lifecycle. We never bundle Claude Code; the SDK is pointed at the user's own `claude` via `pathToClaudeCodeExecutable`.

## Consequences
- Contributors mostly write TypeScript; the same reducer (`@gravita/core`) runs in the engine and the UI.
- The sidecar adds tens of MB per platform; we measure it against the lightness budget and fall back to Node SEA if Bun compile fails signing or size checks.
- macOS hardened runtime needs JIT entitlements for the sidecar.
