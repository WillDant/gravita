# 02 — Gap analysis: o que falta para o provider `cursor`

Legenda: **MVP** (necessário para o primeiro corte) · **Pós-MVP** (planejado depois) ·
**Cancelado** (decidido fora de escopo).

## 1. Protocolo (`packages/protocol`) — MVP

| Lacuna | Onde | Tarefa |
|--------|------|--------|
| `"cursor"` não existe em `AGENT_PROVIDERS` | `src/constants.ts` | T03 |
| `ProviderSchema` e type `Provider` sem `cursor` | `src/events.ts`, `src/ids.ts` | T03 |
| Sem `EventSource` para ACP (`"cursor-acp"`) | `src/events.ts` | T03 |
| Sem `CURSOR_MODES = ["agent","plan","ask"]` / `CursorModeSchema`; `SessionModeSchema` só une Claude+Codex | `src/constants.ts`, `src/events.ts` | T03 |
| `EngineStatus.providers` só tem `claude`/`codex` | `src/rpc.ts` | T03 |
| `ProviderStatus` não descreve a credencial (origem `app`/`none`, estado `missing`/`unchecked`/`valid`/`invalid`) | `src/rpc.ts` | T03 |
| RPC para revalidar a chave sem enviá-la (`cursorKey.validate`) | `src/constants.ts` (`Methods`), `src/rpc.ts` | T03 |
| `TERMINAL_COMMANDS` sem `cursor` | `src/constants.ts` | T14 (Pós-MVP) |
| `SQUAD_PROVIDER_CHOICES` sem `cursor` | — | **Cancelado** (P5) |

## 2. Core puro (`packages/core`) — MVP

| Lacuna | Onde | Tarefa |
|--------|------|--------|
| `DEFAULT_MODE` sem `cursor`; `isModeOf`/`modeFor` binários; sem mapa Claude↔Cursor | `src/session-modes.ts` | T04 |
| `PROVIDER_MODELS satisfies Record<AgentProvider,…>` passa a exigir `cursor` — trocar por tipo só de providers de squad (Claude/Codex) | `src/squad/models.ts` | T04 |
| `allowedProviders`/`roleProviderOf` nunca oferecem `cursor` (permanente) | `src/squad/providers.ts` | T04 |
| Ternários binários em validate-plan, plan-usage, models | ver lista em 01 | T05 |

## 3. Adapter puro (`packages/adapter-cursor`, _novo_) — MVP

| Lacuna | Tarefa |
|--------|--------|
| Tipos ACP mínimos, cliente sobre `JsonRpcConnection`, ids `cursor:` | T06 |
| `CursorAcpMapper` (`session/update` → `GravitaEvent`) com **máscara de segredo** aplicada a todo texto (R13) | T07 |
| `cursorToolCall` + tabela de contrato | T07 |
| Servidor ACP roteirizado e fixtures `fixtures/cursor-acp/<versão>/` | T07 |

## 4. Chave da API (P1) — MVP

| Lacuna | Onde | Tarefa |
|--------|------|--------|
| Acesso ao Keychain no shell Tauri (salvar, ler, apagar item do gravita) | `apps/desktop/src-tauri/` (`Cargo.toml` + módulo _novo_ `cursor_key.rs`, comandos em `lib.rs`) | T17 |
| Entregar a chave ao engine na inicialização e quando mudar, pelo stdin do sidecar | `src-tauri/src/sidecar.rs`; `apps/engine/src/main/main.ts` (ler linhas após o token) | T17 |
| Port `CredentialSource` no engine (valor só em memória) + implementação alimentada pelo stdin + fake p/ testes | `apps/engine/src/application/ports/` _novo_, `infrastructure/system/` _novo_ | T17 |
| Validação da chave pelo próprio `cursor-agent` (comando definido no T01) | `infrastructure/cursor/` | T08 |
| Credencial só da chave do app (sem fallback — P8) e status da credencial | `infrastructure/cursor/cursor-credential.ts`, `cursor-detector.ts` | T08 |
| Ponte webview → comandos Tauri da chave | `apps/desktop/src/infrastructure/platform/tauri.ts` | T11 |
| Tela/fluxo de adicionar, substituir, validar, remover | `apps/desktop/src/features/connect/` | T12 |

## 5. Engine — infraestrutura — MVP

| Lacuna | Onde | Tarefa |
|--------|------|--------|
| `CURSOR`, detector (`cursor-agent`, versão-data `2026.10.14-<hash>`: `detectCli` extrai `2026.10.14` e compara numericamente — cobrir com teste) | `infrastructure/cursor/provider.ts`, `cursor-detector.ts` _novos_ | T08 |
| `filterCursorEnv` = só a allowlist base: **nenhuma** `CURSOR_*`/`AGENT_CLI_*` do shell (nem `CURSOR_API_KEY`/`CURSOR_AUTH_TOKEN`/`CURSOR_API_ENDPOINT`) | `infrastructure/system/login-shell-env.ts` | T08 |
| `DetectedCursorEnvironment`, `cursorChatEnv` (+ `GRAVITA_MANAGED=1`, `CURSOR_API_KEY` do app, `AGENT_CLI_CREDENTIAL_STORE=memory`, `NO_OPEN_BROWSER=1`) | `infrastructure/cursor/cursor-environment.ts` _novo_ | T08 |
| Processo ACP e `CursorAcpRuntime` | `infrastructure/cursor/acp-process.ts`, `cursor-acp-runtime.ts` _novos_ | T09 |
| Falha de auth → `NotLoggedInError("cursor")` + credencial `invalid` | runtime | T09 |

## 6. Engine — application / domain / composição — MVP

| Lacuna | Onde | Tarefa |
|--------|------|--------|
| Mensagens e `modesOf` binários | `domain/errors.ts`, `domain/chat-policy.ts` | T05 |
| Wiring de detector, ambiente, credencial, factory, `cursorKey.validate` | `main/container.ts`, `interface/rpc/router.ts` | T10 |
| `DEFAULT_FALLBACKS.cursor = Auto` | `application/usecases/list-models.ts` | T10 |
| Conversation completa | `TranscriptRouter` | T15 (Pós-MVP) |

**Persistência:** nenhuma migração — `events.json` já carrega `provider` como string; a
chave **nunca** vai para o SQLite.

## 7. Desktop — MVP

| Lacuna | Onde | Tarefa |
|--------|------|--------|
| Status/problemas do Cursor (`missing`, `outdated`, `keyMissing`, `keyInvalid`) e nota "opcional" (P7) | `state/hooks.ts`, `shared/presenters/errors.ts` | T11 |
| Ternários binários de provider da sessão | `shared/presenters/selectors.ts`, `features/session/agent-panel/AgentPanel.tsx`, `state/hooks.ts` | T11 |
| Escolha de provider com 3 opções | `features/new-session/*` | T12 |
| Modos `Agent/Plan/Ask` (sem acesso total) e "Auto" como modelo padrão | `features/session-settings/SettingsSelects.tsx` | T12 |
| Marca "Cursor", guia de conexão, tela da chave | `shared/ui/ProviderMark.tsx`, `features/connect/*` | T12 |
| i18n `en` + `pt-BR` | `shared/i18n/locales/*` | T11, T12 |

## 8. Docs, compliance e CI — MVP

| Lacuna | Onde | Tarefa |
|--------|------|--------|
| ADR 008 (ACP, D1–D7) + adendo ADR 006 | `docs/adr/` | T02 |
| **Exceção de credencial** publicada antes do código | `docs/COMPLIANCE.md` (+ README, frase "never reads your credentials") | T02 |
| `docs/cursor.md`, README, ROADMAP, `.ai/` | — | T13 |
| Testes de compliance: chave só no env do `cursor-agent`, mascarada em eventos, ausente de logs/argv/SQLite/outros providers; `CURSOR_API_KEY` do shell nunca repassada; sem chave do app a sessão não inicia; engine não lê `~/.cursor` | `apps/engine/test/infrastructure/cursor-compliance.test.ts` _novo_; testes Rust do comando de chave | T13 |
| CI | sem mudança de pipeline; nada de Keychain real no CI (fakes) | — |

## 9. Pós-MVP / cancelado

| Item | Situação |
|------|----------|
| Terminal embutido com `cursor-agent` | Pós-MVP — T14 |
| Lente Conversation completa | Pós-MVP — T15 |
| Observar sessões Cursor externas | Pós-MVP — T18 (exige análise de compliance) |
| Squads com Cursor | **Cancelado** — T16 `dropped` |
| `@cursor/sdk` / Cloud Agents | **Não usado** (P2) |
