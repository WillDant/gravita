# 006 — Clean Architecture in the engine and the desktop

Status: accepted (milestone M1a)

## Context
M0 grew around a few large modules: the engine's `Hub` stored, projected and broadcast events and held a mutable permission-responder slot; `ingest.ts` mixed discovery, scheduling, checkpoints and status; the server reached into the store. M1b adds Agent SDK sessions that Gravita runs and controls, so those concerns need clear seams first.

## Decision
Both apps use layers with one dependency rule: **domain ← application ← infrastructure / interface ← main**. Inner layers never import outer ones. Application code depends only on ports (interfaces), never on `bun:sqlite`, `Bun.serve`, `fs`, child processes or `Date.now` (it gets a `Clock`). Only the composition root creates concrete classes.

**Engine (`apps/engine/src`)**
- `domain/`: pure engine policies on top of `@gravita/core` (which sessions are hot, whether a permission is still pending, `NotControllableError`).
- `application/ports/`: `EventStore`, `CheckpointStore`, `EventPublisher`/`StatusReporter`/`EngineFeed`, `Clock`, `Logger`, `ProjectDirectory`, `ProjectionReader`, `SessionRuntime`, `SessionRuntimeRegistry`, `SessionOwnership`.
- `application/services/`: `ProjectionService` (owns the `GravitaState`; snapshots and queries are deep copies), `EventBroadcaster` (33 ms batches, status dedupe), `InMemorySessionRuntimeRegistry` (announces `session.control` on register/unregister).
- `application/usecases/`: `IngestEvents` (the single write path: store → project → publish; ephemeral events are not stored; an optional callback runs in the same transaction), `GetSnapshot`, `GetSessionEvents`, `GetEngineStatus`, `RespondToPermission`, `AnnounceProject`.
- `infrastructure/`: `persistence/` (SQLite event and checkpoint stores sharing one database), `claude/` (`TranscriptDiscovery`, `TailScheduler`, `Registry`, CLI locator), `demo/` (`DemoRuntime`: plays `@gravita/adapter-fake` and registers each demo session as a controllable runtime), `system/` (clock, git project directory, stderr logger).
- `interface/rpc/`: `router.ts` is a pure table method → use case, validating params with the protocol's `RpcContract` and mapping domain errors to `RpcErrors`; `transport.ts` is `Bun.serve` with the Host/Origin allowlists, the token handshake and the payload and auth-timeout limits.
- `main/`: `container.ts` (composition root), `main.ts`, `args.ts`. `src/main.ts` stays as the entry for `bun run` and the sidecar build.

**Adapters.** `@gravita/adapter-claude` separates the pure tail state machine (`SessionTailState`) from I/O (`TranscriptFs`); `readSession` is one poll of a tail with no spawn grace, so both readers share one assembly. Project announcements use `projectDiscoveredEvent` from `@gravita/protocol`.

**Desktop (`apps/desktop/src`).** `app/` (App, hash router, providers), `infrastructure/` (`EngineGateway` interface, `WsEngineGateway`, endpoint resolution for Tauri or the browser), `state/` (zustand slices with the gateway injected through context, and structural sharing of the projection), `features/` (home, project, session with line map and agent panel, agents, permissions; actions go through feature hooks that call the gateway), `shared/` (ui, i18n, utils, presenters). Whether a session can be controlled comes from the engine (`session.controllable`), not from UI rules.

## How to extend
- **A new source** (e.g. Codex rollouts): put an adapter in `infrastructure/<source>/` that turns its input into `GravitaEvent`s and calls `IngestEvents` (pass a checkpoint save as the in-transaction callback if it resumes). If it runs sessions Gravita controls, implement `SessionRuntime` and register it in the `SessionRuntimeRegistry`; the transcript tailer then skips those sessions through `SessionOwnership`. Wire it in `main/container.ts`.
- **A new RPC method**: add its params and result schemas to `RpcContract` in `@gravita/protocol`, write a use case in `application/usecases/` against ports only, and add one entry to `rpcHandlers` in `interface/rpc/router.ts` (the type of the table requires it). Domain errors that clients must tell apart get a mapping in the router. Test the use case with in-memory fakes and the route with the router alone, without a network.

## Consequences
Use cases and the router are tested without SQLite, sockets or timers, and the desktop store with a fake gateway. M1b adds the Agent SDK as one more `SessionRuntime` plus use cases, without touching the transport or the projection. The cost is more files and an explicit wiring step in the container.

## Addendum (M1b): driving sessions through the Agent SDK

- **Ports added:** `ChatRuntimeFactory` (creates a `SessionRuntime` for a new chat), `ClaudeEnvironment` (the user's `claude` path and an allowlisted login-shell env), `Workspace` (is this folder a directory), `TranscriptReader` (full conversation text, read-only), `IdGenerator`.
- **`SessionRuntime` grew** `send`, `interrupt`, `stopAgent`, `setModel`, `setPermissionMode` and `answerQuestion`. Each control has its own use case (`StartChat`, `SendMessage`, `InterruptSession`, `StopAgent`, `SetModel`, `SetPermissionMode`, `AnswerQuestion`, `GetConversation`, `ListModels`) and an RPC method in `RpcContract`.
- **`PermissionBroker`** turns the SDK's `canUseTool` callback into `permission.requested` / `question.asked` events and back into answers.
- **`ClaudeSdkRuntime`** (infrastructure) is the only code that imports the SDK. It runs the user's own `claude` via `pathToClaudeCodeExecutable`; SDK messages go through the pure `SdkSessionMapper` in adapter-claude, which reuses the transcript normaliser so both sources produce identical keys.
- **Policies in `domain/`:** at most six chat sessions at once; bypass mode only when a session starts (`BypassLockedError`), never switched on later.
- **One writer per session:** a registered runtime owns its session, so the transcript tailer skips it until the runtime ends.
