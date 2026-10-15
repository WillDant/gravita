# T08 — Engine: detecção do `cursor-agent`, env sem fallback e status da credencial

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 3 — Engine
- **Dependências:** T05, T17; T01 (versão mínima, mecanismo de isolamento do login salvo, comando de validação)
- **Estimativa:** M

## Objetivo

Encontrar o CLI do Cursor instalado pelo usuário, montar o env de todo processo
`cursor-agent` com **só a chave do app** (P8 — sem fallback), validar a chave pelo próprio
CLI e publicar o status "não configurada / não verificada / válida / inválida" em
`EngineStatus.providers.cursor`.

## Contexto

Molde: `apps/engine/src/infrastructure/codex/codex-detector.ts`,
`codex-environment.ts`, `providers/cli-locator.ts#detectCli`,
`providers/detected-environment.ts`, `system/login-shell-env.ts`.
O instalador oficial coloca `cursor-agent` (e o alias `agent`) em `~/.local/bin`.
Versão impressa: `2026.10.14-0f9edde` — `detectCli` extrai `2026.10.14` e compara
numericamente (ok; cobrir com teste). A chave do app chega pelo port `CredentialSource` (T17).

Credencial (D2, `../00-overview.md`) — fonte única:

| Situação | `credential` | Sessão |
|----------|--------------|--------|
| Sem chave no app (mesmo com `CURSOR_API_KEY` no shell ou login salvo do CLI) | `{ source: "none", state: "missing" }` | não inicia (`notLoggedIn`), nenhum processo `cursor-agent` |
| Chave salva, ainda não validada (ou sem rede — R15) | `{ source: "app", state: "unchecked" }` | inicia |
| Chave aceita pelo CLI | `{ source: "app", state: "valid" }` | inicia |
| Chave recusada pelo CLI | `{ source: "app", state: "invalid" }` | não inicia até substituir/revalidar |

Env de todo processo `cursor-agent` (sessão ACP **e** validação), montado do zero:

| Variável | Origem |
|----------|--------|
| allowlist base (`PATH`, `HOME`, locale…) | shell de login, como Claude/Codex |
| qualquer `CURSOR_*` / `AGENT_CLI_*` do shell ou do `process.env` do engine | **descartada** (inclui `CURSOR_API_KEY`, `CURSOR_AUTH_TOKEN`, `CURSOR_API_ENDPOINT`, `CURSOR_API_URL`) |
| `CURSOR_API_KEY` | chave do app (`CredentialSource`) — nunca em argv |
| `AGENT_CLI_CREDENTIAL_STORE=memory` | fixa (ou o mecanismo escolhido no T01) — não lê nem grava o login salvo (R16) |
| `NO_OPEN_BROWSER=1` | fixa — o CLI nunca abre login no navegador |
| `GRAVITA_MANAGED=1` | fixa |

`CURSOR_API_ENDPOINT` não é repassado: a chave do app só vai para o endpoint padrão do CLI
(justificativa no D2).

## Arquivos afetados

- `apps/engine/src/infrastructure/cursor/provider.ts` _novo_ — `CURSOR = "cursor"`
- `apps/engine/src/infrastructure/cursor/cursor-detector.ts` _novo_ —
  `MIN_CURSOR_VERSION` (inclui suporte ao isolamento do T01 — R17), `knownCursorPaths()`,
  `detectCursor()`, `CursorDetector implements ProviderDetector`; inclui `credential` no
  `ProviderStatus`
- `apps/engine/src/infrastructure/cursor/cursor-credential.ts` _novo_ —
  `cursorCredential(credentials)` → `{ source: "app", key } | { source: "none" }` (só o
  `CredentialSource`; **não** recebe o env do shell nem consulta o CLI);
  `validateCursorKey()` roda o comando do T01 com o env da tabela acima; mapeia sucesso →
  `valid`, recusa de auth → `invalid`, sem rede/timeout → `unchecked` (R15)
- `apps/engine/src/infrastructure/cursor/cursor-environment.ts` _novo_ —
  `DetectedCursorEnvironment`, `cursorChatEnv(env, key)` conforme a tabela acima
- `apps/engine/src/infrastructure/system/login-shell-env.ts` — `filterCursorEnv` = só a
  allowlist base; `isCursorEnvKey` (`CURSOR_*`, `AGENT_CLI_*`) usado para **remover**, não
  para permitir (R6)
- `apps/engine/test/infrastructure/cursor-provider.test.ts` _novo_

## Passos

1. Detector com `detectCli({ binary: "cursor-agent", knownPaths, minVersion })`.
2. `filterCursorEnv` e `cursorChatEnv`; `filterClaudeEnv`, `filterCodexEnv` e o env de
   terminais **não** recebem `CURSOR_API_KEY` (teste).
3. `cursorCredential` + `cursorChatEnv`; spawn sempre com env explícito (nunca herdar o
   `process.env`); a chave **nunca** em argv (`--api-key` proibido).
4. Validação: na inicialização e ao receber chave nova do `CredentialSource`, validar e
   republicar o status; a cada `open()` com falha de auth o runtime (T09) marca `invalid`.
   Sem chave, não roda nenhum processo de validação.
5. Assinar mudanças do `CredentialSource` (salvar/remover) e republicar
   `providers.cursor` sem reiniciar o engine.

## Critérios de aceite

- `detectCursor` encontra o CLI via shell de login e por caminhos conhecidos; `outdated`
  abaixo do mínimo.
- Tabela de credencial coberta por teste, incluindo: sem chave do app + `CURSOR_API_KEY`
  no shell ⇒ `none`/`missing`; chave do app + outra `CURSOR_API_KEY`/`CURSOR_AUTH_TOKEN`
  no shell ⇒ env só com a do app.
- `credential` reflete `app|none` × `missing|unchecked|valid|invalid`; remover a chave ⇒
  `none`/`missing` imediatamente.
- Env do Cursor = allowlist base + `CURSOR_API_KEY` (do app) +
  `AGENT_CLI_CREDENTIAL_STORE` + `NO_OPEN_BROWSER` + `GRAVITA_MANAGED`; nenhuma outra
  `CURSOR_*`/`AGENT_CLI_*`; nada de `ANTHROPIC_*`, `OPENAI_*`, `CODEX_*`.
- Nenhum log contém valores de env nem a chave.

## Como testar

`pnpm --filter @gravita/engine test -- cursor-provider`

## Notas de execução

- `infrastructure/cursor/cursor-detector.ts`: `MIN_CURSOR_VERSION = "2026.10.14"`,
  caminhos conhecidos (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`); o estado da
  chave só é pedido a um CLI encontrado e atual.
- `cursor-environment.ts`: `cursorChatEnv` monta o env do zero (`filterCursorEnv`: só a
  allowlist base e `LC_*`) + `CURSOR_API_KEY`, `AGENT_CLI_CREDENTIAL_STORE=memory`,
  `NO_OPEN_BROWSER=1`, `GRAVITA_MANAGED=1`. Nenhum `CURSOR_*`/`AGENT_CLI_*` do shell passa.
- `cursor-key-validator.ts`: `cursor-agent models` com esse env (timeout 20 s): exit 0 ⇒
  `valid`; recusa de auth com exit ≠ 0 ⇒ `invalid`; o resto ⇒ `unchecked`.
- `application/services/cursor-key-status.ts`: estado publicado no status
  (`updateProvider`), checagem deduplicada por chave, resultado de chave antiga descartado.
- Testes: `cursor-provider.test.ts`.
