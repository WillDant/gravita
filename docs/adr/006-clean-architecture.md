# 006 — Clean Architecture in the engine and the desktop

Status: accepted (before chats in Gravita, v0.1.0-alpha)

## Context
The first version (live observability) grew around a few large modules: the engine's `Hub` stored, projected and broadcast events and held a mutable permission-responder slot; `ingest.ts` mixed discovery, scheduling, checkpoints and status; the server reached into the store. Chats in Gravita add Agent SDK sessions that Gravita runs and controls, so those concerns need clear seams first.

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
Use cases and the router are tested without SQLite, sockets or timers, and the desktop store with a fake gateway. Chats add the Agent SDK as one more `SessionRuntime` plus use cases, without touching the transport or the projection. The cost is more files and an explicit wiring step in the container.

## Addendum: driving chats through the Agent SDK

- **Ports added:** `ChatRuntimeFactory` (creates a `SessionRuntime` for a new chat), `ClaudeEnvironment` (the user's `claude` path and an allowlisted login-shell env), `Workspace` (is this folder a directory), `TranscriptReader` (full conversation text, read-only), `IdGenerator`.
- **`SessionRuntime` grew** `send`, `interrupt`, `stopAgent`, `setModel`, `setPermissionMode` and `answerQuestion`. Each control has its own use case (`StartChat`, `SendMessage`, `InterruptSession`, `StopAgent`, `SetModel`, `SetPermissionMode`, `AnswerQuestion`, `GetConversation`, `ListModels`) and an RPC method in `RpcContract`.
- **`PermissionBroker`** turns the SDK's `canUseTool` callback into `permission.requested` / `question.asked` events and back into answers.
- **`ClaudeSdkRuntime`** (infrastructure) is the only code that imports the SDK. It runs the user's own `claude` via `pathToClaudeCodeExecutable`; SDK messages go through the pure `SdkSessionMapper` in adapter-claude, which reuses the transcript normaliser so both sources produce identical keys.
- **Policies in `domain/`:** at most six chat sessions at once; bypass mode only when a session starts (`BypassLockedError`), never switched on later.
- **One writer per session:** a registered runtime owns its session, so the transcript tailer skips it until the runtime ends.

## Addendum: kill switch and Deep Observe hooks

- **Kill switch:** `StopAllSessions` disposes every runtime in the registry with a cap (shutdown uses it too) and returns how many it stopped. It is the `engine.stopAll` RPC and `POST /control/stop-all` for the tray (engine token as a Bearer header). Sessions without a runtime (terminal ones) are never touched.
- **Plain HTTP routes** live in `transport.ts` beside `/ws`: POST only, any request with an `Origin` header is refused (no web page can reach them), tokens compared in constant time.
- **Runtime file:** the composition root generates a hook token per run and writes `<dataDir>/runtime.json` (port, hook token, pid, version; 0600, temp file + rename) through the `RuntimeFileStore` port (`FsRuntimeFile`). On stop it is removed only if it still holds our pid.
- **Hooks as a source:** `@gravita/adapter-claude` parses a hook (`parseHookPayload`, zod, unknown fields dropped) and maps it purely (`mapHook`): tool facts are wrapped as transcript records and go through `normalizeRecords`, so they carry the transcript's keys and data. Everything else is a signal (`tool-start`, `tool-end`, `prompt`, `turn-end`, `session-end`).
- **Port `HookTranslator`** (implemented by `ClaudeHookTranslator`) keeps the application free of the adapter. **`HookIngest`** (application service) handles hooks one at a time: skips sessions a runtime owns, resolves the project from `cwd` through `AnnounceProject`, and keeps the only state hooks need, the open calls and permission prompts per session and agent. Prompt ids are deterministic (`hook:<toolUseId>`), and prompts still open after a restart are recovered from the projection.
- **Spool:** `DrainHookSpool` + the `HookSpool` port (`FsHookSpool`) replay `<dataDir>/spool/hooks.jsonl` at start and every 30 s (rename, ingest in order, delete). Demo mode serves hooks but leaves the spool to the real engine.
- **The plugin** (`plugins/deep-observe`, listed by `.claude-plugin/marketplace.json`) is installed by the user through Claude Code's `/plugin` flow; Gravita never writes under `~/.claude`.

## Addendum: providers behind one seam

Gravita ran only Claude Code; Codex comes next. Before it does, every place that assumed Claude went behind a seam keyed by provider (`AgentProvider = "claude" | "codex"`), with no change for Claude Code.

- **Protocol.** `EngineStatus.providers` holds a `ProviderStatus` per detected CLI (found, path, version, outdated, logged in, account); `EngineStatus.claude` stays as a deprecated copy of `providers.claude` for one version, so an older UI keeps working. `models.list {provider}` lists a provider's models (`claude.models` is its alias). The errors `providerUnavailable` (4005) and `notLoggedIn` (4008) have neutral messages and name the provider in the JSON-RPC `data` (`ProviderErrorData`); the UI words them per provider, and reads Claude Code when `data` is absent. `session.start` takes an optional `provider` (Claude Code by default). Session modes stay in each provider's terms (Claude's `PermissionMode`, Codex's `ask | workspace | fullAccess`), and core's `session-modes` maps one to the other; `session.settings` events carry Claude's terms (Codex's map one to one).
- **Shared tool helpers** (`@gravita/protocol/tools`, zod-free): `preview`, `inputPreview`, `toolTarget`, `stableJson`, and the neutral `GuardedCall`. `inputKeyOf` hashes with node:crypto, so it lives apart (`@gravita/protocol/input-key`) and never reaches the UI bundle.
- **Ports.** `AgentEnvironment`/`AgentEnvironmentSource` replace `ClaudeEnvironment` (a provider, its CLI path and version, the allowlisted env); `ProviderDetector` finds a provider's CLI (`ClaudeDetector` wraps `detectClaude`; the CLI locator takes the binary name, so a Codex detector reuses it). `ChatRuntimeSpec` names its `provider`; `HookTranslator` names the provider of its events.
- **`RuntimeFactoryRegistry`** (application) maps each provider to its runtime factory and environment source. `StartChat`, squad sessions, the planner, the briefing and the task runner pick from it by the provider the request or the plan names (squads: Claude Code for now, through `SQUAD_PROVIDER` and `roleProvider`). `ListModels` asks only live sessions of the requested provider.
- **Guards on neutral calls.** The ownership guard and the autonomy policy judge a `GuardedCall {kind: read | edit | shell | web | ask | gravita | other, paths, command?, tool}`; each provider has an adapter from its tool calls (`claudeToolCall` in adapter-claude). A provider-neutral contract table (`apps/engine/test/contracts/guarded-call-table.ts`) states the decisions once; every adapter must produce them.
- **What stays Claude Code's** (infrastructure/claude): the planner's and the briefing's tool lists and their permission answers (`claude-access.ts`, chosen through the neutral `ChatRuntimeSpec.access`), the subagent environment variables (`claude-subagent-env.ts`, from the neutral `SubagentPolicy`), the CLI's install paths and minimum version, the Agent SDK runtime, the transcript and registry readers, and the hooks.
- **Core.** Models have tiers per provider (`ModelTier = low | mid | high`, `PROVIDER_MODELS.claude = haiku | sonnet | opus`); `pickModel`, `stepUp`, `estimatePlanCost`, `MODEL_PRICES` and the Automatic policy take a provider (Claude Code when absent, with the same results as before). `modelTier` reads an unknown model as the middle tier of its own provider.
- **`--codex-home`** (default `~/.codex`): where Codex keeps its sessions. The engine takes it and passes it to the core (`EngineCore.homes.codex`); nothing reads it until Codex sessions are observed. Like `~/.claude`, it will only ever be read.
- **Desktop.** `ConnectProvider` shows a provider's connect steps (Claude Code's are unchanged; a provider without guidance yet shows only the error line); `useProviderProblem(provider)` and `useModels(provider)` are keyed by provider.
