# T13 — Documentação e testes de compliance do Cursor

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 5 — Docs e compliance
- **Dependências:** T02, T10, T12, T17
- **Estimativa:** M

## Objetivo

Documentar como o Cursor funciona no gravita e provar, com testes, **cada promessa** da
exceção de credencial publicada no `COMPLIANCE.md` (T02) e o contrato de arquivos.

## Contexto

Modelos: `docs/codex.md`, `docs/COMPLIANCE.md`,
`apps/engine/test/infrastructure/codex-compliance.test.ts` e `compliance.test.ts`.
Exceção D6 em `../00-overview.md`; riscos R11–R15.

## Arquivos afetados

- `docs/cursor.md` _novo_ — requisitos (`cursor-agent` ≥ mínimo, opcional), como
  configurar a chave na UI (única fonte: `CURSOR_API_KEY` do shell e `cursor-agent login`
  **não** são usados — P8), modos (Agent/Plan/Ask), modelos (Auto + conta), limitações
  (sem squads, sem observação externa, sem uso de plano), roteiro de teste manual
  (inclui conferir, a cada versão nova do CLI, que uma sessão não altera o login salvo do
  `cursor-agent` — R16/R17)
- `docs/COMPLIANCE.md` — conferir que o texto publicado no T02 bate com a implementação;
  seção "Cursor": nunca lê `~/.cursor` (credenciais, `cli-config.json`, `chats/`,
  `acp-sessions/`); `clientInfo` identifica o gravita
- `README.md`, `docs/ROADMAP.md`, `.ai/CONTEXT.md`, `.ai/MAP.md`
- `apps/engine/test/infrastructure/cursor-compliance.test.ts` _novo_
- `apps/desktop/src-tauri/src/cursor_key.rs` — testes Rust (fake de Keychain)

## Testes de compliance (um por promessa)

| Promessa | Teste |
|----------|-------|
| Só no Keychain | Rust: `save` chama só o Keychain; engine: nenhum arquivo do data dir contém a sentinela após uma sessão |
| Nunca logada | logs do engine e do shell sem a sentinela (inclusive linha `cursorKey` malformada) |
| Nunca em argv | argv do `cursor-agent` sem a sentinela |
| Só no env do `cursor-agent` | env de Claude, Codex, terminais e checks sem `CURSOR_API_KEY` |
| Chave do shell nunca repassada | shell de login fake e `process.env` do engine com `CURSOR_API_KEY`/`CURSOR_AUTH_TOKEN`/`CURSOR_API_ENDPOINT` sentinela (≠ chave do app): o env do `cursor-agent` (sessão e validação) não contém nenhuma delas, e `CURSOR_API_KEY` = chave do app |
| Sem chave do app, sem sessão | `CredentialSource` vazio + `CURSOR_API_KEY` no shell fake: `session.start {provider:"cursor"}` ⇒ `notLoggedIn`, nenhum processo `cursor-agent` iniciado, nenhuma validação rodada; status `none`/`missing` |
| Login salvo do CLI não é usado | env do `cursor-agent` sempre com `AGENT_CLI_CREDENTIAL_STORE=memory` (ou o mecanismo do T01) e `NO_OPEN_BROWSER=1`; nenhum caminho do engine chama `cursor-agent login`/`logout` |
| Mascarada em eventos | servidor roteirizado imprime a sentinela; eventos/SQLite trazem `••••` |
| Nunca pela webview/WS | nenhum método RPC aceita/retorna a chave; `cursor_key_present` devolve só bool |
| Remoção | `cursor_key_remove` apaga o item e o engine passa a `source: "none"` (sem cair em outra credencial) |
| Nada de `~/.cursor` | home fake com iscas; nenhum caminho aberto; bytes e mtime idênticos |

## Passos

1. Escrever os docs (inglês, como o resto de `docs/`).
2. Implementar a tabela de testes acima.
3. Ligar cada linha ao item correspondente no ADR 008.

## Critérios de aceite

- Docs revisados; links do README funcionam.
- Testes de compliance verdes no CI (sem Keychain real).

## Como testar

`pnpm --filter @gravita/engine test -- compliance` e `cargo test` em `apps/desktop/src-tauri`.

## Notas de execução

- `docs/cursor.md` (requisitos, chave, estados, modos, modelos, limitações, roteiro manual
  com o antes/depois do login do `cursor-agent`), README (Cursor e `adapter-cursor`),
  `docs/ROADMAP.md` (Next › Cursor chats), `.ai/CONTEXT.md`, `.ai/MAP.md`,
  `docs/COMPLIANCE.md` revisado.
- Cobertura da tabela de promessas:
  - Só no Keychain: Rust (`cursor_key.rs`, fake de store) + engine (sentinela ausente do
    SQLite). Nunca logada: logs do engine sem a sentinela; stderr mascarado.
  - Nunca em argv / só no env do `cursor-agent`: `cursor-provider.test.ts` (validação) e
    `cursor-chat.test.ts` (sessão); varredura de código: só `cursor-environment.ts` e
    `container.ts` citam `CURSOR_API_KEY`.
  - Chave do shell nunca repassada: env com iscas `CURSOR_*`/`AGENT_CLI_*`/`OPENAI_*`.
  - Sem chave, sem sessão: `notLoggedIn`, nenhum processo, nenhuma validação.
  - Login salvo não usado: `AGENT_CLI_CREDENTIAL_STORE=memory` + `NO_OPEN_BROWSER=1`;
    varredura: sem `authenticate`, `login`/`logout`, `.cursor/…`, keychain no engine.
  - Mascarada em eventos; nunca pela webview/WS (nenhum parâmetro RPC de chave;
    `cursor_key_present` só bool); remoção ⇒ `none`/`missing`.
  - **Parcial:** "nada de `~/.cursor`" é provado por varredura de código, não por um home
    falso com iscas e mtime (o engine não tem nenhum caminho que leia `~/.cursor`).
