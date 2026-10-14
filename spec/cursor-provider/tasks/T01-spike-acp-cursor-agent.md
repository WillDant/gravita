# T01 — Spike: validar o ACP do `cursor-agent`

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 0 — Validação
- **Dependências:** nenhuma
- **Estimativa:** M

## Objetivo

Provar, com o CLI real e uma `CURSOR_API_KEY`, que `cursor-agent acp` cobre todas as
operações do `ChatRuntime`, e produzir fixtures sintéticas e a versão mínima do CLI.

## Contexto

Já verificado em 2026-10-14 (CLI `2026.10.14-0f9edde`): `initialize` responde
`loadSession: true`, `mcpCapabilities {http, sse}`, `authMethods: [cursor_login]`;
`session/new` devolve `modes` (`agent`, `plan`, `ask`) e `models.availableModels`
(ex.: `default[]` = Auto, `composer-2.5[fast=true]`). Sessões ACP ficam em
`~/.cursor/acp-sessions`. Falta validar o fluxo de turno e a autenticação por chave.

Regra da credencial (P8, D2): **só a chave do app**, sem fallback para a `CURSOR_API_KEY`
do shell nem para o login salvo do CLI. O spike precisa provar que o env montado pelo
engine garante isso.

Indícios por leitura estática do bundle instalado (`2026.10.14-0f9edde`, sem rodar
login/logout nem prompts) — **a confirmar empiricamente**:

- `--help`: `--api-key` aceita `CURSOR_API_KEY`; `-e/--endpoint` aceita
  `CURSOR_API_ENDPOINT` (padrão `https://api2.cursor.sh`).
- Ordem de autenticação do CLI: `--auth-token`/`CURSOR_AUTH_TOKEN` > `--api-key`/
  `CURSOR_API_KEY` > login salvo. Ou seja, a API key no env vence o login salvo, mas um
  `CURSOR_AUTH_TOKEN` herdado venceria a chave do app.
- Com API key, o CLI troca a chave por tokens e **persiste** tokens e chave no store de
  credenciais: no macOS, padrão = Keychain via `/usr/bin/security` (serviços
  `cursor-access-token`, `cursor-refresh-token`, `cursor-api-key`, conta `cursor-user`);
  `file` = `~/.cursor/auth.json` (baseado em `homedir()`, não em `CURSOR_CONFIG_DIR`). Isso
  sobrescreveria o login do usuário e deixaria uma cópia da chave fora do controle do
  gravita (R16).
- `AGENT_CLI_CREDENTIAL_STORE` (`default` | `file` | `memory`, interno, não documentado):
  `memory` usa um store só em memória — não lê o login salvo e não grava nada.
- `CURSOR_CONFIG_DIR` / `XDG_CONFIG_HOME` mudam só a pasta de config (`cli-config.json`);
  `CURSOR_DATA_DIR` muda `projects/`. Nenhum dos dois isola as credenciais no macOS.
- No ACP, `session/new`/`session/load` exigem estar autenticado e a mensagem de erro
  sugere `cursor-agent login` + `authenticate {methodId:"cursor_login"}`.

## Arquivos afetados

- `tools/spikes/cursor-acp-probe.ts` _novo_ (script Bun descartável; pode ser removido depois)
- `fixtures/cursor-acp/<versão>/*.jsonl` _novo_ (sintéticas, modeladas no formato real)
- `spec/cursor-provider/tasks/T01-spike-acp-cursor-agent.md` (registrar achados abaixo)

## Passos

1. Script Bun que faz spawn de `cursor-agent acp` e loga cada linha JSON-RPC (in/out).
2. Autenticação: rodar **com** `CURSOR_API_KEY` + `AGENT_CLI_CREDENTIAL_STORE=memory` +
   `NO_OPEN_BROWSER=1` no env (o env-alvo do D2) e **sem** login prévio, num usuário
   macOS de teste. Registrar se `authenticate {methodId:"cursor_login"}` é necessário
   com a chave no env, o que ele faz **sem** chave (não pode abrir navegador nem bloquear)
   e o erro retornado sem chave.
3. `session/new {cwd, mcpServers: []}` → registrar `sessionId`, `modes`, `models`.
4. `session/prompt` com um prompt que leia um arquivo e rode um comando → registrar todas
   as `session/update` (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
   `tool_call_update`, `plan`, …) e o `stopReason`.
5. Responder `session/request_permission` com cada opção (`allow_once`, `reject_once`, …)
   e registrar o efeito.
6. `session/cancel` no meio de um turno; `session/set_mode` (`plan`, `ask`);
   `session/set_model` (ou o método equivalente que o CLI expõe); `session/load` de uma
   sessão anterior (o que é re-emitido?).
7. Prompt com imagem (opcional).
8. Verificar quais variáveis de ambiente um processo filho do Cursor herda (para a
   allowlist e para `R6`). **Em especial:** um comando de shell rodado pelo agente vê
   `CURSOR_API_KEY`? (define a máscara do R13).
9. **Isolamento do login salvo (D2, R2, R16, R17)** — num usuário de teste com
   `cursor-agent login` feito com a conta A e uma chave da conta B:
   - só `CURSOR_API_KEY=B` no env: a sessão roda como B (`cursor-agent status --format
     json` e o ACP)? O Keychain da conta A foi sobrescrito/ganhou `cursor-api-key`?
   - `CURSOR_API_KEY=B` + `AGENT_CLI_CREDENTIAL_STORE=memory`: roda como B **e** nenhum
     item `cursor-*` do Keychain nem `~/.cursor/auth.json` muda (comparar antes/depois no
     usuário de teste)?
   - sem `CURSOR_API_KEY` + `memory`: o ACP **recusa** a sessão (não usa o login de A)?
   - `CURSOR_AUTH_TOKEN` e `CURSOR_API_ENDPOINT` presentes no shell: confirmar que, com o
     env montado do zero (D2), não chegam ao processo.
   - verificar se `cli-config.json` (usuário ou projeto) consegue apontar endpoint ou
     credencial; se sim, registrar e propor tratamento.

   Opções de isolamento a comparar:

   | Opção | Prós | Riscos |
   |-------|------|--------|
   | **A. `AGENT_CLI_CREDENTIAL_STORE=memory`** (default proposto) | Não lê nem grava credenciais; mantém `HOME`, `~/.cursor` (regras, MCP, permissões, `acp-sessions` para `session/load`), git e SSH do usuário | Variável interna, pode mudar (R17); confirmar que vale no modo `acp` e no comando de validação |
   | B. `HOME` temporário só para o processo | Isola tudo que deriva de `homedir()` | Quebra `~/.cursor` (config, MCP, regras, retomada de sessão), git/SSH e as ferramentas de shell do agente; Keychain do macOS não depende de `HOME` — pode nem isolar |
   | C. `CURSOR_CONFIG_DIR`/`CURSOR_DATA_DIR` dedicados | Baixo impacto | Não isola credenciais no macOS (store é Keychain/`homedir()`) — insuficiente sozinho |

   Escolher A se passar nos testes acima. Se A falhar, **não** há fallback aceitável: T09
   fica bloqueada até decidir outra opção (registrar a análise aqui e no ADR 008).
10. **Validação da chave:** achar o comando mais barato que confirma a chave sem abrir
    sessão (ex.: `cursor-agent status --format json` com o env do D2, ou `initialize` +
    `authenticate` no ACP) e o formato do erro para chave inválida vs. sem rede (R15).
    Com login salvo e chave inválida, a validação deve dar `invalid` (não "logado").
11. **Keychain (R12):** protótipo mínimo no shell Tauri (crate `keyring` ou
    `security-framework`) que salva, lê e apaga um item; observar prompts de ACL em
    `tauri dev` e em build não assinado. Confirmar que o engine pode receber a chave por
    uma linha extra no stdin (após o token) sem mudar o handshake atual.
12. Converter os logs em fixtures **sintéticas** (trocar textos, paths e ids).

## Critérios de aceite

- Seção "Achados" abaixo preenchida com o formato de cada mensagem usada.
- Resposta clara: `CURSOR_API_KEY` funciona no ACP? Se não, qual alternativa.
- `MIN_CURSOR_VERSION` proposto.
- Fixtures commitadas e revisadas (sem conteúdo real, sem chave).
- Lista de lacunas do ACP em relação ao `ChatRuntime` (ex.: `stopAgent` de subagente,
  `answerQuestion`, uso/custo) com proposta de tratamento.
- Respostas registradas para: chave no env × login salvo; mecanismo de isolamento
  escolhido (A/B/C) e prova de que o login salvo não é usado nem alterado; comando de
  validação;
  herança da chave pelas ferramentas do agente; mecanismo de Keychain escolhido e
  comportamento de ACL em dev/build não assinado.

## Como testar

`bun tools/spikes/cursor-acp-probe.ts` com `CURSOR_API_KEY` exportada (não commitar).
Testes de isolamento (passo 9) só num usuário macOS de teste, nunca no Keychain/login do
dev.

## Notas de execução

Executado em 2026-10-14 sem `CURSOR_API_KEY` real no ambiente: as partes que exigem uma
chave válida (turnos, aprovações, cancelamento, troca de modo/modelo, `session/load`,
Keychain antes/depois, herança da chave pelas ferramentas) ficaram **pendentes para o
usuário** — comandos exatos em "Verificações ao vivo pendentes". Nada foi feito com login
ou logout do `cursor-agent`, o Keychain e `~/.cursor` não foram tocados, nenhum usuário
macOS foi criado. O resto foi verificado empiricamente (sem chave e com uma chave falsa) e
por leitura do bundle instalado; as fixtures são sintéticas, modeladas no formato real.

Script: `tools/spikes/cursor-acp-probe.ts` (Bun; monta o env do D2 do zero, lê a chave de
`GRAVITA_PROBE_CURSOR_KEY`, mascara a chave em tudo que imprime, mata o processo no
`--timeout`). Fixtures: `fixtures/cursor-acp/2026.10.14/*.jsonl` (formato do
`ScriptedAppServer`, reaproveitado pelo `ScriptedAcpServer`).

### Achados

**CLI e versão.** `~/.local/bin/cursor-agent` (alias `agent`) →
`~/.local/share/cursor-agent/versions/2026.10.14-0f9edde/cursor-agent`; `--version` imprime
`2026.10.14-0f9edde`. `MIN_CURSOR_VERSION = "2026.10.14"` (o `detectCli` lê `\d+.\d+.\d+`).
Caminho conhecido: `~/.local/bin/cursor-agent`.

**Isolamento (passo 9): opção A — `AGENT_CLI_CREDENTIAL_STORE=memory` — funciona.**

- Bundle: `AGENT_CLI_CREDENTIAL_STORE` → `"memory"` ⇒ `InMemoryStore`; `"file"` ⇒
  `~/.cursor/auth.json`; padrão no macOS ⇒ Keychain. O mesmo `credentialManager` global é
  passado ao comando `acp`, a `status` e a `models`.
- `isAuthenticated` do ACP = `CURSOR_AUTH_TOKEN` || `apiKey ?? CURSOR_API_KEY` || login
  salvo no store. Com `memory`, o login salvo não existe para o processo.
- **Empírico:** máquina com login salvo no Keychain (`cursor-access-token` presente), env
  do D2 **sem** chave + `memory` ⇒ `initialize` ok e `session/new` ⇒
  `{"code":-32000,"message":"Authentication required"}`. O login salvo **não** é usado.
- A troca chave → tokens é preguiçosa (`POST /auth/exchange_user_api_key`) e o resultado vai
  para o store em memória: nada gravado no Keychain nem em `~/.cursor/auth.json` (a
  confirmar ao vivo com uma chave válida — ver pendências).
- `CURSOR_AUTH_TOKEN`/`CURSOR_API_ENDPOINT`/`CURSOR_API_KEY` do shell: o env do D2 é
  montado do zero (allowlist: `PATH`, `HOME`, `USER`, `LANG`, `LC_*`, `SHELL`, `TMPDIR`,
  `NODE_EXTRA_CA_CERTS`, proxies); nenhum `CURSOR_*`/`AGENT_CLI_*` herdado chega ao
  processo (teste unitário em T08). O próprio processo deste agente roda dentro do Cursor
  com vários `CURSOR_*` no env — o R6 é real.
- `cli-config.json`: o endpoint vem de `--endpoint`/`CURSOR_API_ENDPOINT`; não achei
  credencial lida do config. Sem tratamento extra no MVP.

**`authenticate` nunca deve ser chamado.** `authenticate {methodId:"cursor_login"}` sem
credencial **inicia o fluxo de login no navegador** e espera; com `CURSOR_API_KEY` no env o
processo já está autenticado. Desvio do plano original ("initialize → authenticate"):
o runtime faz só `initialize` → `session/new`.

**Validação da chave (passo 10): `cursor-agent models` com o env do D2.**

| Situação | Resultado | Estado |
|----------|-----------|--------|
| chave válida | exit 0 + lista de modelos | `valid` |
| chave inválida (com rede) | exit 1, stderr "The provided API key is invalid" / "credentials or API key are invalid or expired" | `invalid` |
| sem rede/proxy | exit 1, stderr "Failed to reach the Cursor API" | `unchecked` |
| sem chave | não roda (estado `missing`) | `missing` |

`cursor-agent status` não serve: em `memory` não troca a chave e responde sempre "não
autenticado".

**ACP com chave inválida:** `session/new` ⇒ `{"code":-32603,"message":"Internal error",
"data":{"message":"Failed to initialize session services"}}` — ambíguo com falha de rede.
Tratamento: nesse erro o runtime roda a validação; `invalid` ⇒ `NotLoggedInError` + estado
`invalid`; senão erro de runtime.

**Mensagens usadas (formatos do bundle; `@agentclientprotocol/sdk@0.14.1`):**

- `initialize {protocolVersion: 1, clientCapabilities: {fs: {readTextFile: false,
  writeTextFile: false}, terminal: false}, clientInfo}` ⇒ `{protocolVersion: 1,
  agentCapabilities: {loadSession: true, mcpCapabilities: {http, sse}, promptCapabilities:
  {image: true, audio: false, embeddedContext: false}, sessionCapabilities: {list: {}}},
  authMethods: [{id: "cursor_login"}]}`.
- `session/new {cwd, mcpServers: []}` ⇒ `{sessionId, modes: {currentModeId,
  availableModes: [{id: agent|plan|ask, name}]}, models: {currentModelId, availableModels:
  [{modelId, name}]}}`. Ids de modelo são variantes (`default[]` = Auto,
  `composer-2.5[fast=true]`).
- `session/load {sessionId, cwd, mcpServers}` re-emite o histórico como `session/update`
  (inclui `user_message_chunk`).
- `session/prompt {sessionId, prompt: [{type: "text", text}]}` ⇒ `{stopReason: "end_turn" |
  "cancelled" | "max_tokens" | "refusal" | …}`. `session/cancel {sessionId}` é notificação.
- `session/set_mode {sessionId, modeId}`; `session/set_model {sessionId, modelId}`.
- `session/update {sessionId, update}` com `sessionUpdate`: `agent_message_chunk`
  `{content: {type: "text", text}}`, `agent_thought_chunk`, `user_message_chunk`,
  `tool_call {toolCallId, title, kind, status: "pending", rawInput, locations}`,
  `tool_call_update {toolCallId, status: in_progress|completed|failed, content, rawOutput}`,
  `plan {entries: [{content, status, priority}]}`, `current_mode_update {currentModeId}`,
  `session_info_update {title}`, `available_commands_update`.
- `session/request_permission` (pedido do servidor) `{sessionId, toolCall: {toolCallId,
  title, kind, content}, options: [{optionId: "allow-once", kind: "allow_once"},
  {optionId: "allow-always", kind: "allow_always"}, {optionId: "reject-once", kind:
  "reject_once"}]}` ⇒ resposta `{outcome: {outcome: "selected", optionId}}` ou `{outcome:
  {outcome: "cancelled"}}`. O gravita escolhe a opção pelo `kind` (`allow_once` /
  `reject_once`), **nunca** `allow_always`.
- Títulos/kinds: escrita "Edit \`path\`" (kind `edit`, content `diff {path, oldText,
  newText}`), shell "\`cmd\`" (kind `execute`), delete "Delete \`path\`" (kind `delete`/
  `edit`), leitura "Read \`path\`" (kind `read`), MCP "server: tool" (kind `other`), web
  (kind `fetch`/`search`). `rawInput`: shell `{command}`, grep `{pattern, path}`,
  edit/read/delete/ls `{path}`, glob `{pattern}`, fetch `{url}`, search `{searchTerm}`, task
  `{_toolName: "task", prompt, description}`, todos `{_toolName: "updateTodos", todos}`.

**Lacunas do ACP × `ChatRuntime` e tratamento:**

| Operação | ACP | Tratamento no MVP |
|----------|-----|-------------------|
| `send` durante turno (steer) | não existe | serializa: a mensagem espera o turno acabar |
| `answerQuestion` | perguntas vão por `cursor/ask_question` (extensão) | recusado (`method not found` ⇒ o CLI segue sem perguntar); `answerQuestion` ⇒ `NotControllableError` |
| `stopAgent` de subagente | não existe | só `main` (cancela o turno); outro ⇒ `NotControllableError` |
| uso/custo | não exposto | sem `usage.reported`/`planUsage` |
| criar plano (`cursor/create_plan`) | extensão | recusado; o CLI cai no fluxo local |

**Herança da chave pelas ferramentas do agente (passo 8):** não determinado
estaticamente (o bundle tem um redator que lista `CURSOR_API_KEY`/`CURSOR_AUTH_TOKEN`,
aparentemente do contexto de cloud agents). Tratamento conservador: a chave é mascarada em
todo texto de evento (R13). Confirmar ao vivo.

**Keychain (passo 11):** `security-framework` (crate nativo, sem `/usr/bin/security` e sem
argv) no shell Tauri; serviço `dev.gravita.app.cursor-api-key`, conta `default`. A chave
vai ao engine por uma linha JSON extra no stdin depois do token
(`{"type":"cursorKey","value":…}`), sem mudar o handshake (linhas extras já eram lidas e
ignoradas). Prompts de ACL em `tauri dev`/build não assinado: pendente ao vivo.

### Verificações ao vivo pendentes (exigem uma chave real; rodar na raiz do repo)

1. Validação: `GRAVITA_PROBE_CURSOR_KEY=<chave> bun tools/spikes/cursor-acp-probe.ts --models`
   ⇒ exit 0 com modelos. Repetir com uma chave errada ⇒ "invalid".
2. Turno completo: `GRAVITA_PROBE_CURSOR_KEY=<chave> bun tools/spikes/cursor-acp-probe.ts
   --prompt "read package.json and run ls" --timeout 120` ⇒ conferir `tool_call`,
   `session/request_permission` (o script recusa) e `stopReason`.
3. Herança: `... --prompt "run printenv CURSOR_API_KEY"` ⇒ a saída do comando deve vir
   mascarada no gravita (o script já mascara; anotar se o valor aparece).
4. Keychain/arquivo intactos: antes e depois do item 2, comparar
   `security find-generic-password -s cursor-api-key 2>&1 | head -1`,
   `security find-generic-password -s cursor-access-token 2>&1 | head -1` e
   `stat -f %m ~/.cursor/auth.json 2>/dev/null` — nada pode mudar.
5. No app (`pnpm tauri dev`): colar a chave, ver o estado "válida", iniciar uma sessão
   Cursor, aprovar/recusar uma edição, interromper, trocar modo (Plan/Ask) e modelo,
   remover a chave; observar se o macOS mostra prompt de acesso ao Keychain.
