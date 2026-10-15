# T17 — Chave da API do Cursor: Keychain, entrega ao engine e `CredentialSource`

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 3 — Engine e chave (**MVP** — P1)
- **Dependências:** T01 (mecanismo de Keychain), T02 (exceção publicada), T03 (tipos de status)
- **Estimativa:** G

## Objetivo

Guardar a chave colada pelo usuário **só no Keychain do macOS** e entregá-la ao engine sem
passar pelo WebSocket, para que o engine a injete como `CURSOR_API_KEY` apenas nos
processos `cursor-agent` (T08/T09). A UI que chama estes comandos fica no T11/T12.

## Contexto

- `apps/desktop/src-tauri/src/sidecar.rs` inicia o engine com `--token-stdin`, escreve o
  token na 1ª linha e **guarda o `ChildStdin`** (`Mutex<Option<ChildStdin>>`) — dá para
  escrever mais linhas depois. O engine encerra no EOF.
- `apps/engine/src/main/main.ts` (`readStdinToken`) hoje lê só a 1ª linha.
- `Cargo.toml` não tem acesso a Keychain; `lib.rs` registra os comandos Tauri.
- Regras da exceção D6 (`../00-overview.md`) e riscos R11–R14.

## Desenho

```text
webview ──invoke──► comando Tauri ──► Keychain (item "gravita · Cursor API key")
                         │
                         └──► stdin do engine: {"type":"cursorKey","value":"…"|null}
engine main.ts ──► MemoryCredentialSource (só memória) ──► T08 resolve / T09 injeta
```

- **Startup:** depois do token, o shell lê o Keychain e, se houver chave, envia a linha
  `cursorKey`. Se o Keychain negar/pedir permissão, o engine sobe sem chave e o Cursor
  fica "chave não configurada" (mensagem de acesso negado — R12); não há outra origem.
- **Salvar/substituir:** grava no Keychain e envia a linha nova.
- **Remover:** apaga o item e envia `value: null`.
- A webview **nunca lê** a chave de volta: só `cursor_key_present() -> bool`.

## Arquivos afetados

Shell Tauri:
- `apps/desktop/src-tauri/Cargo.toml` — crate de Keychain escolhido no T01
- `apps/desktop/src-tauri/src/cursor_key.rs` _novo_ — `save`, `remove`, `present`, `load`
  atrás de um trait (fake nos testes Rust)
- `apps/desktop/src-tauri/src/sidecar.rs` — `Engine::send_line(json)` reutilizando o
  `ChildStdin` guardado; envio da chave no startup
- `apps/desktop/src-tauri/src/lib.rs` — comandos `cursor_key_set(key)`,
  `cursor_key_remove()`, `cursor_key_present()`; validação básica de formato (não vazio,
  sem quebras de linha); nunca logar o argumento

Engine:
- `apps/engine/src/application/ports/credential-source.ts` _novo_ —
  `CredentialSource { cursorKey(): string | undefined; onChange(cb): () => void }`
- `apps/engine/src/infrastructure/system/memory-credential-source.ts` _novo_
- `apps/engine/src/main/main.ts` — após o token, continuar lendo linhas JSON do stdin;
  tipo desconhecido ⇒ ignorar (sem logar o conteúdo); repassar o `CredentialSource` ao
  `startEngine` (T10)
- `apps/engine/test/fakes/` — `FakeCredentialSource`
- `apps/engine/test/main/stdin-messages.test.ts` _novo_

## Passos

1. Módulo Rust do Keychain + testes com fake.
2. `send_line` no sidecar; envio no startup e nos comandos.
3. Leitor de linhas no `main.ts` mantendo o handshake atual (1ª linha = token).
4. Port + implementação em memória + fake.
5. Testes: linha `cursorKey` atualiza o `CredentialSource`; `null` limpa; linha inválida
   não derruba o engine nem aparece em log.

## Critérios de aceite

- Chave sobrevive a reinício do app (Keychain) e pode ser removida.
- Nenhum arquivo do gravita (SQLite, `runtime.json`, logs, spool) contém a chave.
- Nenhum método JSON-RPC do engine recebe ou devolve a chave (R14).
- Sem Tauri (engine + Vite no navegador) o engine sobe sem chave: Claude/Codex funcionam
  e o Cursor fica "chave não configurada" (sem fallback para env/login — P8).
- Testes Rust e do engine verdes; nada de Keychain real no CI.

## Como testar

`cargo test` em `apps/desktop/src-tauri` e `pnpm --filter @gravita/engine test -- stdin`.
Manual: `pnpm --filter @gravita/desktop tauri dev`, salvar a chave, conferir no Acesso às
Chaves e reiniciar o app.

## Notas de execução

- `src-tauri/src/cursor_key.rs`: trait `KeyStore`; Keychain via `security-framework = "3"`
  (só macOS; item `dev.gravita.app.cursor-api-key` / conta `default`; -25300 = não
  encontrado); `normalize` (trim, não vazio, ≤ 512, sem espaço/controle); a linha
  `{"type":"cursorKey","value":…}` montada com `serde_json`. Fora do macOS: erro.
- `sidecar.rs`: `write_bootstrap(token, key)` no startup; `Engine::send_line` para
  salvar/remover depois. `lib.rs`: comandos `cursor_key_set`, `cursor_key_remove`,
  `cursor_key_present -> bool`; o argumento nunca é logado.
- Engine: porta `CredentialSource`, `MemoryCredentialSource` (+ `applyBootstrapLine`) em
  `infrastructure/credentials/`, `main/stdin-bootstrap.ts`. Linha desconhecida ou
  malformada é ignorada sem logar o conteúdo.
- `cargo check` ok; `cargo test`: 15 pass (5 novos). Clippy limpo.
- **Não verificado:** o Keychain real (prompts de ACL, persistência entre reinícios) —
  ver o roteiro manual em `docs/cursor.md`.
