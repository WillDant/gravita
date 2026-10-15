# 03 — Plano de implementação

Princípio: cada fase deixa o repositório **verde** (`pnpm test && pnpm typecheck && pnpm lint`)
e mergeável. Nada aparece para o usuário até a Fase 4. A **política de credencial é
publicada (ADR + `COMPLIANCE.md`) antes de qualquer código que guarde a chave**.

## Grafo de dependências (MVP)

```text
Fase 0  T01 (spike ACP + chave + Keychain) ──► T02 (ADR 008 + COMPLIANCE.md)
                │                                   │
Fase 1          ├──► T03 (protocol) ──► T04 (core) ──► T05 (ternários)
                │        │                              │
Fase 2          └──► T06 (adapter: cliente) ──► T07 (adapter: mapper + máscara)
                         │                              │
Fase 3          T17 (chave: Keychain + stdin + CredentialSource)  ◄── T01, T02, T03
                         │
                T08 (detecção + env sem fallback + status) ◄── T05, T17
                         │
                T09 (runtime ACP) ◄── T07, T08
                         │
                T10 (wiring container + cursorKey.validate + modelos)
                         │
Fase 4          T11 (desktop: estado, presenters, ponte Tauri) ◄── T05, T17
                         │
                T12 (desktop: UI, tela da chave, i18n) ◄── T10, T11
                         │
Fase 5          T13 (docs + testes de compliance) ◄── T02, T10, T12

Pós-MVP: T14 (terminal) · T15 (Conversation) · T18 (sessões externas)
Cancelado: T16 (squads)
```

## Fase 0 — Validação e decisão

- **T01** — Spike: ACP, autenticação por `CURSOR_API_KEY`, isolamento do login salvo do
  CLI (`AGENT_CLI_CREDENTIAL_STORE=memory` — D2/R16), comando de validação da chave, env repassado às ferramentas do agente (R13), Keychain a
  partir do shell Tauri (R12).
- **T02** — ADR 008 (D1–D7) e atualização do `docs/COMPLIANCE.md` com a exceção D6.

**Aceite:** achados do T01 registrados; ADR 008 aceito; `COMPLIANCE.md` já descreve a
exceção de credencial (mesmo antes do código existir, marcada "a partir da versão X").
Se o ACP reprovar, o ADR registra o fallback (`-p --output-format stream-json`) e T06–T09
são reescritas antes de seguir.

## Fase 1 — Tipos e core (sem comportamento visível)

- **T03** — `cursor` no protocolo, `CURSOR_MODES`, status de credencial, `cursorKey.validate`.
- **T04** — Modos do Cursor no core; tabela de modelos só para providers de squad.
- **T05** — Eliminar ternários binários de provider.

**Aceite:** typecheck verde com `"cursor"`; nenhum ponto trata Cursor como Claude; squads
continuam recusando `cursor`.

## Fase 2 — Adapter puro `@gravita/adapter-cursor`

- **T06** — Pacote, tipos ACP, cliente, ids.
- **T07** — Mapper com máscara de segredo, `cursorToolCall`, fixtures, servidor roteirizado.

**Aceite:** pacote sem I/O de processo; replay determinístico; tabela de contrato verde;
uma fixture que imprime a chave sentinela gera eventos sem ela.

## Fase 3 — Engine e chave

- **T17** — Chave no Keychain (shell Tauri), entrega ao engine por stdin, port
  `CredentialSource` (só memória).
- **T08** — Detector, ambiente sem fallback (só a chave do app — P8), validação e status.
- **T09** — `CursorAcpRuntime` / factory.
- **T10** — Wiring, `cursorKey.validate`, modelos (Auto + conta).

**Aceite:**
- Com chave no app, o processo `cursor-agent` recebe `CURSOR_API_KEY` com esse valor e
  `AGENT_CLI_CREDENTIAL_STORE=memory`, e nenhuma `CURSOR_*` do shell; sem chave no app,
  nenhum processo `cursor-agent` é iniciado (P8).
- `EngineStatus.providers.cursor.credential` reflete `app|none` e
  `missing|unchecked|valid|invalid`; trocar/remover a chave atualiza o status sem reiniciar.
- `session.start {provider:"cursor"}` funciona ponta a ponta com o servidor roteirizado
  (mensagens, permissão allow/deny, interrupt, modelo, modo, fim de turno, dispose, kill switch).
- Sem chave do app → `notLoggedIn` com `data.provider = "cursor"`, mesmo com
  `CURSOR_API_KEY` no shell ou login salvo do `cursor-agent`.
- A chave não aparece em argv, logs, eventos, SQLite nem no env de Claude/Codex/terminais.

## Fase 4 — Desktop

- **T11** — Estado, presenters, ponte para os comandos Tauri da chave, gateway fake.
- **T12** — New session com 3 providers, modos/modelos do Cursor, marca, guia de conexão,
  **tela da chave** (adicionar, substituir, validar, remover), i18n.

**Aceite:** fluxo completo no app Tauri: colar a chave → validada → iniciar chat Cursor;
chave inválida → mensagem e opção de substituir; remover → "chave não configurada" e
sessões Cursor bloqueadas (CTA para configurar). CLI ausente → nota "opcional" (P7),
distinta de "chave não configurada". `pnpm check:bundle` verde.

## Fase 5 — Documentação e compliance

- **T13** — `docs/cursor.md`, README, ROADMAP, `.ai/`, testes de compliance (engine e Rust).

**Aceite:** cada promessa da exceção D6 tem um teste; docs coerentes com o
`COMPLIANCE.md` publicado no T02.

## Pós-MVP

| Tarefa | Quando faz sentido |
|--------|-------------------|
| T14 — Terminal embutido com `cursor-agent` | Logo após o MVP (baixo custo; mesma regra de chave: só a do app) |
| T15 — Lente Conversation completa | Quando houver demanda por histórico completo |
| T18 — Observar sessões Cursor externas | Após análise de compliance de `~/.cursor` |

T16 (squads) foi **cancelada** (P5).

## Estratégia de testes (resumo)

- **Unit (Bun test):** core, adapter-cursor (cliente, ids, mapper, máscara, tools).
- **Integração engine:** `cursor-chat.test.ts` com servidor ACP roteirizado e
  `CredentialSource` fake; montagem do env (chave do app, nada do shell) em
  `cursor-provider.test.ts`.
- **Contrato:** `contracts/guarded-call-table.ts` com casos Cursor.
- **Compliance:** `cursor-compliance.test.ts` (chave sentinela) + testes Rust do módulo de
  chave com Keychain fake.
- **Desktop (Vitest):** New session, tela da chave, ConnectProvider, ProviderMark, errors,
  locales.
- **Manual (fora do CI):** roteiro em `docs/cursor.md`, com app assinado e chave real.
