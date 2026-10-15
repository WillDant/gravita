# Cursor como provider do gravita — visão geral

> Decisões do dono do produto registradas em 2026-10-14 (ver `riscos-e-perguntas.md`).

## Objetivo

Permitir que o gravita **inicie e controle sessões de agente do Cursor** usando a assinatura
Cursor do usuário, autenticada por **API key configurada na UI do gravita**, do mesmo jeito
que hoje faz com Claude Code e Codex: escolher o provider no "New session", conversar,
aprovar ferramentas, interromper, trocar modelo e modo, e ver tudo no mapa de linhas.

## Escopo (MVP)

- Novo provider `cursor` em `AgentProvider` (protocolo, core, engine, desktop).
- Detecção do CLI do Cursor (`cursor-agent`) instalado pelo usuário, com versão mínima;
  Cursor é **opcional**, com nota discreta quando não instalado (como o Codex — P7).
- **Chave da API pela UI** (P1): adicionar, substituir, validar e remover a chave; guardada
  no **Keychain do macOS**; injetada como `CURSOR_API_KEY` **somente** no processo
  `cursor-agent` que o gravita inicia. É a **única** fonte de credencial (P8): sem
  fallback para o shell nem para o login do CLI. Status do provider mostra chave
  não configurada / não verificada / válida / inválida.
- **Chats** Cursor: streaming de mensagens/raciocínio/tool calls, pedidos de permissão
  respondidos na UI, interrupção, troca de modelo, troca de modo, retomada de sessão.
- **Modos:** só `Agent`, `Plan` e `Ask` (P3). Sem modo de acesso total.
- **Modelos:** "Auto" + modelos da conta (lista dinâmica da sessão); Auto é o padrão (P4).
- UI: escolha do provider, modos e modelos do Cursor, marca "Cursor", guia de conexão,
  tela da chave, textos `en` e `pt-BR`.
- ADR 008, exceção de credencial no `docs/COMPLIANCE.md`, `docs/cursor.md`, testes de
  compliance.

## Fora do MVP

- **Squads com Cursor** — **cancelado** (P5, T16 `dropped`).
- **Observar sessões Cursor iniciadas fora do gravita** (`~/.cursor`) — pós-MVP (P6, T18).
- Terminal embutido com `cursor-agent` (T14) e lente Conversation completa (T15) — pós-MVP.
- **Uso do plano / budgets** para Cursor — sem API equivalente.
- **`@cursor/sdk` e Cursor Cloud Agents** — não serão usados (P2).

## Abordagem: `cursor-agent acp` (Agent Client Protocol)

O gravita roda o `cursor-agent` **instalado pelo usuário** em modo servidor ACP
(`cursor-agent acp`): JSON-RPC 2.0 delimitado por linha via stdio, **um processo por
sessão** — o mesmo formato da integração do Codex (`codex app-server`), que já tem a
infraestrutura pronta (`JsonRpcConnection`, `PermissionBroker`, process group para o kill
switch, `RuntimeFactoryRegistry`, `ProviderDetector`).

Verificado localmente (CLI `2026.10.14-0f9edde`):

- `initialize` → `loadSession: true`, `mcpCapabilities: {http, sse}`,
  `promptCapabilities.image: true`, `authMethods: [cursor_login]`.
- `session/new` → `modes: agent | plan | ask` e `models.availableModels` com ids
  parametrizados (`default[]` = Auto, `composer-2.5[fast=true]`, …).
- Sessões ACP ficam em `~/.cursor/acp-sessions` (estado do próprio Cursor).

| `ChatRuntime` | ACP |
|---------------|-----|
| `open()` | sem chave do app ⇒ nem faz spawn; senão spawn `cursor-agent acp` (env montado pelo engine — D2) → `initialize` → `authenticate` → `session/new` ou `session/load` |
| `send()` | `session/prompt` (resposta traz `stopReason` = fim do turno) |
| stream de eventos | `session/update` (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `current_mode_update`) |
| `respondPermission()` | resposta ao request `session/request_permission` (via `PermissionBroker`) |
| `interrupt()` / `stopAgent(main)` | notificação `session/cancel` |
| `setPermissionMode()` | `session/set_mode` |
| `setModel()` / `supportedModels()` | `session/set_model` / `models` de `session/new` |
| `dispose()` | encerra o process group |

Alternativas descartadas: `@cursor/sdk` in-process (sem callback de aprovação de
ferramentas, +~15 MB no sidecar, beta — descartado por P2); `cursor-agent -p
--output-format stream-json` (processo por turno, sem aprovações — só fallback se o
spike T01 reprovar o ACP); Cloud Agents API (não é local).

## Decisões (consolidar no ADR 008 — T02)

1. **D1 — Transporte:** ACP via `cursor-agent acp`, um processo por sessão, process group
   próprio. Ids com prefixo `cursor:`. SDK não é usado (P2).
2. **D2 — Fonte única da chave (P8):** a única credencial do Cursor é a **chave configurada
   na UI do gravita** (Keychain). **Não há fallback**: a `CURSOR_API_KEY` do shell nunca é
   repassada e o login salvo do `cursor-agent` (`cursor-agent login`) nunca é usado. Sem
   chave no app, o provider aparece como **"chave não configurada"** e sessões não
   iniciam (CTA para configurar na UI) — estado distinto de **"CLI não instalado"** (nota
   opcional, como o Codex — P7). O status mostra a origem `app` ou `none`.

   O engine impede o fallback ativamente ao montar o env de **todo** processo
   `cursor-agent` (sessão ACP e validação da chave), partindo só da allowlist base:
   - **não herda** nenhuma variável `CURSOR_*` nem `AGENT_CLI_*` do shell de login nem do
     próprio processo do engine — em especial `CURSOR_API_KEY`, `CURSOR_AUTH_TOKEN` (que o
     CLI prioriza sobre a API key) e `CURSOR_API_ENDPOINT`/`CURSOR_API_URL`;
   - **injeta** `CURSOR_API_KEY=<chave do app>` explicitamente no env (nunca `--api-key`
     em argv);
   - **injeta** `AGENT_CLI_CREDENTIAL_STORE=memory`, para o CLI não ler o login salvo
     (Keychain `cursor-*` / `~/.cursor/auth.json`) nem gravar lá tokens derivados da chave
     (R16), e `NO_OPEN_BROWSER=1` (nunca abrir login no navegador) — a confirmar no T01;
   - **`CURSOR_API_ENDPOINT` não é repassado:** um endpoint herdado mandaria a chave do app
     para outro host (contraria D6, "nunca enviada a outro destino") e pode vir de um
     Cursor pai (R6). O CLI usa o endpoint padrão; endpoint customizado fica fora do MVP
     (se houver demanda, vira configuração na UI ao lado da chave, não variável do shell).
3. **D3 — Modos:** `CURSOR_MODES = agent | plan | ask`; aprovação de ferramentas sempre pelo
   `PermissionBroker`; sem acesso total (P3).
4. **D4 — Pacote:** novo `packages/adapter-cursor` (puro) com cliente ACP, mapper
   `session/update → GravitaEvent`, `cursorToolCall` e servidor ACP roteirizado; reusa
   `JsonRpcConnection` de `@gravita/adapter-codex`.
5. **D5 — Modelos:** "Auto" (`default[]`) + `availableModels` da sessão; Auto é o padrão (P4).
6. **D6 — Política de credencial (exceção estreita ao `COMPLIANCE.md`):** o gravita passa a
   guardar **uma** credencial, e só porque o usuário a colou explicitamente:
   - guardada **apenas no Keychain do macOS**, item do gravita, pelo shell Tauri;
   - nunca escrita em disco pelo gravita (banco, `runtime.json`, logs, spool), nunca em
     eventos, nunca em argv, nunca devolvida à webview depois de salva;
   - entregue ao engine pelo **stdin do sidecar** (canal já usado para o token), nunca
     pelo WebSocket/JSON-RPC;
   - injetada **somente** no env dos processos `cursor-agent` iniciados pelo gravita (nunca
     em Claude, Codex, terminais ou checks), como única credencial deles (D2);
   - nunca enviada a outro destino: a validação também é feita pelo próprio `cursor-agent`;
   - o valor exato é **mascarado** em qualquer texto que vire evento (R13);
   - "Remover chave" apaga o item do Keychain e a cópia em memória do engine.
   Login Claude e credenciais Codex continuam intocados — a proibição vale como antes.
7. **D7 — Fora de escopo:** squads (cancelado), observação externa (pós-MVP), uso de plano.

## Documentos desta iniciativa

- [01 — Análise da integração atual](01-analise-atual.md)
- [02 — Gap analysis](02-gap-analysis.md)
- [03 — Plano de implementação](03-plano-implementacao.md)
- [Riscos e perguntas](riscos-e-perguntas.md)
- Tarefas: [`tasks/`](tasks/) — status em [`../BOARD.md`](../BOARD.md)
