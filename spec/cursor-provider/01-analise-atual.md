# 01 — Como Claude Code e Codex estão integrados hoje

> Fotografia do código em 2026-10-14 (v0.4.0-beta). Caminhos relativos à raiz do repo.

## Resumo

O gravita **não fala com APIs de modelo diretamente**. Ele dirige o **CLI de agente que o
usuário instalou e logou** e normaliza tudo para um único modelo de eventos (`GravitaEvent`).
Há duas formas de integração por provider:

| | Claude Code | Codex |
|---|---|---|
| Rodar sessões (chat/squad) | `@anthropic-ai/claude-agent-sdk` (`query()` em streaming-input), apontando para o `claude` do usuário (`pathToClaudeCodeExecutable`) | `codex app-server` (JSON-RPC por stdio, protocolo vendored) — um processo por sessão |
| Observar sessões externas | Tail de transcripts `~/.claude/projects` + registry + hooks Deep Observe | Tail de rollouts `~/.codex/sessions` |
| Credenciais | Nunca lidas; login é do `claude` | Nunca lidas; login é do `codex` (`codex login`) |
| Uso do plano | Eventos de rate limit do SDK | `account/rateLimits/read` via app-server/probe |

**O Codex é o molde mais próximo para o Cursor**: processo filho por sessão falando
JSON-RPC por stdio, com aprovações delegadas ao cliente.

## A "costura" de providers (seam)

Documentada em `docs/adr/006-clean-architecture.md` → "Addendum: providers behind one seam"
e "Addendum: the Codex runtime". Peças:

### Protocolo (`packages/protocol/src`)

| Símbolo | Arquivo | Papel |
|---------|---------|-------|
| `AGENT_PROVIDERS = ["claude","codex"]`, `AgentProvider`, `DEFAULT_PROVIDER` | `constants.ts` | Lista canônica de providers que o gravita roda/detecta |
| `CLAUDE_MODES`, `CODEX_MODES` | `constants.ts` | Modos nativos de cada provider |
| `SQUAD_PROVIDER_CHOICES = ["claude","codex","mixed"]` | `constants.ts` | Escolha de provider de squads |
| `TERMINAL_COMMANDS = ["shell","claude","codex"]` | `constants.ts` | O que o terminal embutido roda |
| `RpcErrors.providerUnavailable` (4005), `notLoggedIn` (4008), `ProviderErrorData` | `constants.ts` | Erros neutros com `data.provider` |
| `ProviderSchema = z.enum(["claude","codex","gravita","fake"])`, `AgentProviderSchema` | `events.ts` | Provider no envelope de todo evento |
| `EventSource` (`sdk`, `transcript`, `codex-rpc`, `codex-rollout`, …) | `events.ts` | Origem do evento |
| `SessionModeSchema = union(PermissionModeSchema, CodexModeSchema)` | `events.ts` | Modo de sessão nos termos do provider |
| `Provider` type, `sessionNodeId`, `keys.*` | `ids.ts` | Ids determinísticos / chaves de idempotência |
| `ProviderStatus`, `EngineStatus.providers: {claude?, codex?}` | `rpc.ts` | Status de cada CLI (found, version, outdated, loggedIn, account) |
| `StartSessionParams.provider`, `ModelsListParams {provider}`, `UsageRefreshParams` | `rpc.ts` | RPCs parametrizados por provider |
| `PlanRole.provider` | `squad.ts` | Provider de cada role de squad |

### Core puro (`packages/core/src`)

| Símbolo | Arquivo | Observação |
|---------|---------|------------|
| `DEFAULT_MODE: Record<AgentProvider, SessionMode>`, `isModeOf`, `modeFor`, `CODEX_MODE_OF`, `CLAUDE_MODE_OF` | `session-modes.ts` | **Binário**: `provider === "codex" ? … : claude` |
| `PROVIDER_MODELS` (`satisfies Record<AgentProvider, …>`), `pickModel`, `parseCodexModel` | `squad/models.ts` | Tiers de modelo por provider (squads) |
| `roleProviderOf`, `plannerProviderOf`, `allowedProviders`, `squadProvidersOf` | `squad/providers.ts` | Binário claude/codex |
| `validatePlan` | `squad/validate-plan.ts:324` | Mensagem binária |
| `squadProfile` por provider | `squad/plan-usage.ts:41` | Binário |

### Engine — application (`apps/engine/src/application`)

| Port / serviço | Arquivo | Papel |
|----------------|---------|-------|
| `ChatRuntime`, `ChatRuntimeFactory`, `ChatRuntimeSpec`, `TurnOutcome` | `ports/chat-runtime.ts` | **Contrato que cada provider implementa** para rodar sessões |
| `SessionRuntime` (send, interrupt, stopAgent, setModel, setPermissionMode, respondPermission, answerQuestion, supportedModels, dispose) | `ports/session-runtime.ts` | Controle de sessão viva |
| `AgentEnvironment {provider, cliPath, cliVersion, env}`, `AgentEnvironmentSource` | `ports/agent-environment.ts` | CLI detectado + env allowlisted |
| `ProviderDetector {provider, detect(), account?()}` | `ports/provider-detector.ts` | Detecta CLI e (opcional) conta |
| `RuntimeFactoryRegistry` | `services/runtime-factory-registry.ts` | Mapa provider → factory + environment; `ready(provider)` |
| `PermissionBroker` | `services/permission-broker.ts` | Pedidos de permissão/pergunta aguardando resposta da UI |
| `ListModels`, `DEFAULT_FALLBACKS`, `ModelCatalogs` | `usecases/list-models.ts` | Modelos por provider (sessão viva → catálogo → fallback) |
| `StartChat` | `usecases/start-chat.ts` | Escolhe provider (default Claude), valida modo, `factory.create`, `open?()`, registra, envia 1ª msg |
| `TranscriptRouter` | `services/transcript-router.ts` | Lente Conversation por provider |
| `PlanUsageMonitor` + `PlanUsageSource` | `services/plan-usage-monitor.ts`, `ports/plan-usage-source.ts` | Uso do plano por provider |
| `StatusReporter.updateProvider/providerStatus` | `ports/event-publisher.ts`, `services/event-broadcaster.ts` | Publica `EngineStatus.providers` |

### Engine — domain (`apps/engine/src/domain`)

- `errors.ts`: `ProviderUnavailableError`, `NotLoggedInError`, `PlanUsageUnavailableError`
  montam o nome do provider com ternário binário (`provider === "codex" ? "Codex" : "Claude Code"`).
- `chat-policy.ts`: `modesOf(provider)` binário.
- `terminal-command.ts`: `terminalArgv` (`claudeArgs` / `codexArgs`).

### Engine — infraestrutura Claude (`apps/engine/src/infrastructure/claude`)

- `provider.ts` → `CLAUDE = "claude"`.
- `claude-cli-locator.ts` → `ClaudeDetector` (usa `providers/cli-locator.ts#detectCli`).
- `claude-environment.ts` → `DetectedClaudeEnvironment`.
- `sdk/claude-sdk-runtime.ts` → `ClaudeSdkRuntime`/`ClaudeSdkRuntimeFactory` (único lugar que
  importa o SDK); `chatEnv()` adiciona `GRAVITA_MANAGED=1` e `CLAUDE_AGENT_SDK_CLIENT_APP`.
- `sdk/gravita-mcp-server.ts` → role tools in-process para squads.
- `claude-session-source.ts`, `transcript-*.ts`, `registry.ts`, `claude-hook-translator.ts`,
  `claude-plan-usage.ts` → observação e uso.
- Adapter puro: `packages/adapter-claude` (`SdkSessionMapper`, `normalizeRecords`,
  `claudeToolCall`, hooks).

### Engine — infraestrutura Codex (`apps/engine/src/infrastructure/codex`) — **molde**

| Arquivo | Símbolo | Equivalente Cursor |
|---------|---------|-------------------|
| `provider.ts` | `CODEX` | `CURSOR` |
| `codex-detector.ts` | `detectCodex`, `knownCodexPaths`, `MIN_CODEX_VERSION`, `CodexDetector` | `CursorDetector` |
| `codex-environment.ts` | `DetectedCodexEnvironment`, `codexChatEnv` | `DetectedCursorEnvironment`, `cursorChatEnv` |
| `app-server-process.ts` | `spawnAppServer`, `stopAppServer`, `AppServerLauncher` | `spawnAcpServer` |
| `codex-app-server-runtime.ts` | `CodexAppServerRuntime(Factory)` (~1000 linhas) | `CursorAcpRuntime(Factory)` |
| `codex-account-probe.ts`, `codex-account.ts` | login/plano/modelos sem chat | opcional (status via `authenticate`) |
| `codex-plan-usage.ts`, `codex-squad-profile.ts`, `codex-presence.ts`, `codex-session-*.ts`, `codex-transcript-reader.ts` | uso, squads, observação | fora do MVP |

Adapter puro: `packages/adapter-codex` — `app-server/json-rpc.ts` (`JsonRpcConnection`,
genérico, reaproveitável), `app-server/client.ts`, `app-server/rpc-mapper.ts`
(`CodexRpcMapper`), `app-server/session-policy.ts`, `ids.ts` (prefixo `codex:`),
`tools.ts` (`codexToolCall`), `testing/scripted-app-server.ts` + `fixtures/codex-rpc/`.

### Engine — sistema / composição

- `infrastructure/system/login-shell-env.ts`: captura `$SHELL -lic env -0` uma vez e filtra
  por allowlist: `EXACT` + `PREFIXES` (Claude: `ANTHROPIC_`, `CLAUDE_CODE_`, …) e
  `CODEX_PREFIXES` (`OPENAI_`, `CODEX_`, …); `filterShellEnv` = união. **Nenhuma variável
  `CURSOR_*` passa hoje.**
- `infrastructure/providers/cli-locator.ts`: `detectCli({binary, knownPaths, minVersion})`
  — genérico, roda só `<cli> --version`.
- `infrastructure/terminal/provider-terminal-flags.ts`: flags por provider (binário).
- `main/container.ts`: composition root. `createCore()` monta `ClaudeSdkRuntimeFactory`,
  `CodexAppServerRuntimeFactory`, `RuntimeFactoryRegistry({claude, codex})`,
  `PlanUsageMonitor`, `ListModels(..., {codex: codexModels})`; `startEngine()` monta
  `detectors: ProviderDetector[]`, `ChatOptions` (`environment`, `codexEnvironment`,
  `codexLaunch`…), e publica `broadcaster.updateProvider` após cada detecção.
- `interface/rpc/router.ts`: `models.list → listModels.execute(p.provider)`; mapeia
  `ProviderUnavailableError`/`NotLoggedInError` para `providerError(...)` com `data.provider`.
- Persistência (`infrastructure/persistence/sqlite-database.ts`): tabela `events` guarda o
  evento como JSON; **provider não é coluna** → **nenhuma migração SQL necessária**.

### Desktop (`apps/desktop/src`)

| Arquivo | O que conhece de provider |
|---------|---------------------------|
| `state/hooks.ts` | `providerStatus`, `problemOf`, `useProviderProblem`, `canStartWith` (demo só Claude), `useModels(provider)`, `useCodexNote`, `useAccountPlan` |
| `state/slices/control.ts` | `models`/`modelsStatus: Partial<Record<AgentProvider, …>>` |
| `features/new-session/NewSessionPanel.tsx` | `ProviderChoice` itera `AGENT_PROVIDERS`; lógica `canClaude`/`canCodex`/`only` binária |
| `features/new-session/useNewSession.ts` | provider do formulário |
| `features/session-settings/SettingsSelects.tsx` | `PROVIDER_MODES` (Claude/Codex), `MODEL_DEFAULT: Record<AgentProvider,string>`, `isFullAccess` |
| `features/connect/ConnectProvider.tsx` | `GUIDES` (passos de instalar/atualizar/logar por provider) |
| `features/connect/CodexNote.tsx` | aviso "Codex ausente/desatualizado" |
| `shared/ui/ProviderMark.tsx` | `MARKS = {codex: {name:"Codex", short:"Cx"}}` |
| `shared/presenters/errors.ts` | `PROVIDER_COPY: Record<AgentProvider, …>` |
| `shared/presenters/selectors.ts:37`, `features/session/agent-panel/AgentPanel.tsx:196` | binário `=== "codex" ? "codex" : "claude"` |
| `shared/presenters/planUsage.ts`, `features/home/Home.tsx` | uso do plano por provider |
| `features/new-squad/*`, `features/squad/**` | escolha e marcas de providers em squads |
| `infrastructure/engine/GatewayError.ts`, `WsEngineGateway.ts`, `EngineGateway.ts` | erros e RPCs com provider |
| `shared/i18n/locales/en.ts`, `pt-BR.ts` | ~57 chaves com "codex" cada (`newSession.provider.*`, `mode.codex.*`, `connect.codex.*`, `error.codex*`, `provider.codex.session`) |
| `test/FakeGateway.ts` | gateway fake com status de providers |

### Testes e fixtures existentes (referência para os do Cursor)

- Engine: `apps/engine/test/infrastructure/codex-chat.test.ts`,
  `codex-compliance.test.ts`, `claude-sdk-runtime.test.ts`, `compliance.test.ts`,
  `application/providers.test.ts`, `application/chat-usecases.test.ts`,
  `main/container.test.ts`, `contracts/guarded-call-table.ts`, helpers
  `codex-rpc-helpers.ts`, `codex-helpers.ts`.
- Fixtures: `fixtures/codex-rpc/<versão>/*.jsonl` (sintéticas; **nunca** transcripts reais).
- Desktop: `NewSessionPanel.test.tsx`, `Composer.test.tsx`, `ConnectProvider.test.tsx`,
  `ProviderMark.test.tsx`, `errors.test.ts`, `locales.test.ts`, `Home.test.tsx`.
- CI: `.github/workflows/ci.yml` — `biome ci`, typecheck, testes, build UI, `check:bundle`.
  Nada específico de provider; testes não podem depender de CLIs reais.

### Build do sidecar

`tools/build-sidecar.ts` compila o engine com `bun build --compile` e marca
`@anthropic-ai/claude-agent-sdk-*` como externo (nunca empacota binários do Claude). A
abordagem ACP **não adiciona dependências npm** ao engine.

### Shell Tauri e canal com o engine (relevante para a chave — P1)

- `apps/desktop/src-tauri/src/sidecar.rs`: o shell inicia o engine com
  `--token-stdin --port 0`, escreve o token na primeira linha do stdin e **mantém o stdin
  aberto** (EOF = engine encerra). `apps/engine/src/main/main.ts` lê só a primeira linha
  hoje. Esse canal é o caminho proposto para entregar a chave ao engine sem passar pelo
  WebSocket.
- `apps/desktop/src-tauri/src/lib.rs`: comandos Tauri expostos à webview (hoje: porta e
  token do engine); `sign_in.rs`: sign-in do perfil Codex.
- `apps/desktop/src-tauri/Cargo.toml`: só `tauri-plugin-dialog` e `-notification`; **não
  há acesso a Keychain** ainda.
- `apps/desktop/src/infrastructure/platform/tauri.ts`: ponte da webview para comandos Tauri.
- O desktop **não tem tela de configurações**; a gestão da chave entra em
  `features/connect/` (T12).

## Pontos com ternário binário (risco de cair em "Claude" silenciosamente)

Quando `AgentProvider` ganhar `"cursor"`, os `Record<AgentProvider, …>` exaustivos quebram
o typecheck (bom), mas estes **compilam e erram em silêncio** (tratam Cursor como Claude):

```text
packages/core/src/session-modes.ts:41,56
packages/core/src/squad/providers.ts:32
packages/core/src/squad/plan-usage.ts:41
packages/core/src/squad/validate-plan.ts:324
packages/core/src/squad/models.ts:91,111,199
apps/engine/src/domain/errors.ts:27,55,195
apps/engine/src/domain/chat-policy.ts:18
apps/engine/src/domain/terminal-command.ts:60
apps/engine/src/infrastructure/terminal/provider-terminal-flags.ts:8,19,22
apps/engine/src/application/usecases/spawn-terminal.ts:74,81
apps/engine/src/application/squad/task-runner.ts:176
apps/engine/src/application/squad/prompts.ts:13,19,43,84,99
apps/engine/src/application/squad/squad-orchestrator.ts:119,135
apps/engine/src/main/container.ts:815
apps/engine/src/infrastructure/demo/demo-runtime.ts:47
apps/engine/src/infrastructure/codex/codex-squad-profile.ts:156,161
packages/adapter-fake/src/script.ts:82,88,93,381
apps/desktop/src/state/hooks.ts:61,91
apps/desktop/src/shared/presenters/selectors.ts:37
apps/desktop/src/shared/presenters/planUsage.ts:19
apps/desktop/src/features/session/agent-panel/AgentPanel.tsx:196
apps/desktop/src/features/squad/run/squadOrbit.ts:35
apps/desktop/src/features/squad/run/squad-map/SquadMap.tsx:89
apps/desktop/src/features/new-squad/NewSquadPanel.tsx:69,79,83,88,368,414,429
apps/desktop/src/features/new-squad/useNewSquad.ts:78,124
```

## Compliance (restrições que moldam a solução)

`docs/COMPLIANCE.md` e ADR 005: o gravita **nunca lê/guarda/encaminha credenciais**, nunca
loga ninguém por conta própria (exceto o perfil Codex de squads, via o próprio Codex),
nunca empacota o CLI do provider, nunca escreve no home do provider, e repassa ao agente só
um **allowlist** do env do shell de login. Testes de compliance auditam o filesystem. A
integração do Cursor deve seguir o mesmo contrato.
