# T09 — Engine: `CursorAcpRuntime` (implementação do `ChatRuntime`)

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 3 — Engine
- **Dependências:** T07, T08 (P3 e P4 decididos: Agent/Plan/Ask; Auto padrão + modelos da conta)
- **Estimativa:** G

## Objetivo

Rodar uma sessão de chat Cursor controlada pelo gravita: um processo `cursor-agent acp`
por sessão, com streaming de eventos, aprovações na UI, interrupção, modelo, modo,
retomada e encerramento seguro (kill switch).

## Contexto

Contrato: `apps/engine/src/application/ports/chat-runtime.ts` (`ChatRuntime`,
`ChatRuntimeFactory`, `ChatRuntimeSpec`, `TurnOutcome`) e `ports/session-runtime.ts`.
Molde direto: `apps/engine/src/infrastructure/codex/codex-app-server-runtime.ts`
(`open()` define o id final, `PermissionBroker`, `nextTurn()`, `end()`/`closed()`) e
`codex/app-server-process.ts` (`spawnAppServer`, `stopAppServer`, process group).

## Arquivos afetados

- `apps/engine/src/infrastructure/cursor/acp-process.ts` _novo_ — `spawnAcpServer(logger,
  debug)` → `AppServerLauncher`-like (`cursor-agent acp`, cwd da sessão, env do T08,
  process group próprio, stderr filtrado); ou generalizar `codex/app-server-process.ts`
  para receber o argv (preferível se ficar simples)
- `apps/engine/src/infrastructure/cursor/cursor-acp-runtime.ts` _novo_ —
  `CursorAcpRuntime implements ChatRuntime`, `CursorAcpRuntimeFactory`
- `apps/engine/test/infrastructure/cursor-chat.test.ts` _novo_
- `apps/engine/test/cursor-acp-helpers.ts` _novo_ (como `codex-rpc-helpers.ts`)

## Comportamento esperado

| Método | Implementação |
|--------|---------------|
| `open()` | lê a chave do app (T08); **sem chave ⇒ `NotLoggedInError(CURSOR)` antes de qualquer spawn** (`source: "none"`, sem olhar shell nem login do CLI) → spawn com o env do T08 (`CURSOR_API_KEY` do app, `AGENT_CLI_CREDENTIAL_STORE=memory`, sem `CURSOR_*` herdada) → `initialize` → `authenticate` (erro de auth ⇒ `NotLoggedInError(CURSOR)` + `credential.state = "invalid"`) → `session/new {cwd, mcpServers: []}` ou, com `spec.resume`, `session/load`. `sessionId` passa a ser `cursor:<acpSessionId>`. Guarda `modes` e `models` |
| `start()` | começa a consumir notificações (já ativas desde o spawn) |
| `send(text, uuid)` | serializa envios; `session/prompt {prompt:[{type:"text",text}]}`; resposta com `stopReason` ⇒ entrega `TurnOutcome` (`end_turn` ⇒ success, `cancelled` ⇒ interrupted, `refusal`/`max_*` ⇒ erro). Mensagem durante um turno: enfileira para o próximo (ACP não tem steer — validar no T01) |
| `interrupt()` | notificação `session/cancel` |
| `stopAgent(id)` | `main` ⇒ `interrupt()`; outro ⇒ `NotControllableError` |
| `setModel(m)` | `session/set_model` (ou equivalente do T01); `"default"` ⇒ `default[]` |
| `setPermissionMode(mode)` | valida `isCursorMode`; `session/set_mode` |
| `respondPermission` | `session/request_permission` aguarda o `PermissionBroker`; allow ⇒ opção `allow_once`; deny ⇒ `reject_once`; dispose/cancel ⇒ `cancelled` |
| `answerQuestion` | se o Cursor não tiver perguntas estruturadas no ACP, rejeitar com `NotControllableError` |
| `supportedModels()` | `models.availableModels` (`modelId` → `value`, `name` → `displayName`); "Auto" (`default[]`) primeiro e padrão quando `spec.model` não vier (P4) |
| `dispose()` | aborta pedidos pendentes, fecha cliente, mata o process group (timeout), `end("disposed")` |
| crash do processo | evento `error {kind:"runtime", message:"Cursor stopped unexpectedly"}` e `end("crashed")` |

Política: `spec.permissionPolicy`/`spec.access` respeitados como no Codex
(`accessVerdict`). Chats rejeitam `roleTools`/`toolGuard`. Nenhum modo libera acesso total
(P3); nunca passar `--force`.

Segredo: o runtime cria o mapper (T07) com `redact` que troca o valor exato da chave em
uso por `••••` e aplica o mesmo filtro às linhas de stderr antes de logar (R13).

## Passos

1. Processo + cliente + mapper (T07) + broker.
2. Ciclo de turno e `nextTurn()`.
3. Controles (cancel, modo, modelo).
4. Testes de integração com o servidor roteirizado cobrindo a tabela acima e o kill switch
   (`registry.opening()` cancelado durante `open()`).

## Critérios de aceite

- Todos os cenários da tabela testados com `@gravita/adapter-cursor/testing`.
- Nenhum processo `cursor-agent` sobrevive a `dispose()` nem ao `engine.stopAll`.
- A chave nunca aparece em argv, log ou evento (teste com valor sentinela, inclusive
  quando o servidor roteirizado "imprime" a chave na saída de uma ferramenta).
- Chave rejeitada ⇒ `notLoggedIn` + status `invalid`; sem chave do app ⇒ `notLoggedIn`
  com `source: "none"` e **nenhum** processo iniciado, mesmo com `CURSOR_API_KEY` no env
  do engine/shell.
- O processo recebe a chave do app, não a do shell (teste com duas sentinelas
  diferentes).

## Como testar

`pnpm --filter @gravita/engine test -- cursor-chat`

## Notas de execução

- `CursorAcpRuntime`: um `cursor-agent acp` por chat; `initialize` → `session/new`
  (nunca `authenticate`); sem chave ⇒ `NotLoggedInError` sem iniciar processo.
- `session/new` -32000/"auth" ⇒ chave `invalid` + `NotLoggedInError`; -32603 (ambíguo) ⇒
  roda a validação: `invalid` ⇒ `NotLoggedInError`, senão erro "Cursor couldn't start the
  session". Sucesso ⇒ chave `valid`.
- `session/prompt` dura o turno todo: `send` enfileira e responde na hora; mensagens durante
  um turno esperam (sem steer). Interrupt = `session/cancel` + aborta aprovações pendentes.
- Aprovações pelo `PermissionBroker`; só `allow_once`/`reject_once` (nunca "always").
- Modelo padrão Auto (`default[]` ⇔ `"default"` na UI); modo e modelo aplicados com
  `session/set_mode`/`set_model`.
- A chave é mascarada nos eventos (mapper), nos erros e no stderr logado
  (`spawnStdioAgent` com `secretEnv`). Crash ⇒ fim de turno `crashed` + evento de erro.
- Recusa squads, ferramentas de papel, guard, resume e modos de outro provider.
- Testes: `cursor-chat.test.ts` (15).
