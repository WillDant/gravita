# Riscos e perguntas

## Perguntas decididas (2026-10-14)

| # | Pergunta | Decisão | Tarefas afetadas |
|---|----------|---------|------------------|
| **P1** | Como a API key chega ao gravita? | **Pela UI do gravita**, guardada no **Keychain do macOS** e injetada só no processo `cursor-agent`. Entra no MVP (T17). Fonte única, sem fallback (P8; ver D2 e D6 em `00-overview.md`) | T01, T02, T03, T08, T09, T10, T11, T12, T13, T17 |
| **P2** | CLI ou SDK? | **CLI instalado** (`cursor-agent acp`). O `@cursor/sdk` **não será usado** | T02, T06–T09 |
| **P3** | Modos do Cursor? | **Só `Agent`, `Plan` e `Ask`**, com aprovação de ferramentas na UI. **Sem** modo de acesso total (`--force`/"Run Everything") | T04, T09, T12 |
| **P4** | Quais modelos mostrar? | **"Auto" + modelos disponíveis na conta** (lista dinâmica vinda da sessão). **Auto é o padrão** | T09, T10, T12 |
| **P5** | Squads no Cursor? | **Não.** T16 cancelada (fora de escopo) | T04, T05, T16 |
| **P6** | Observar sessões externas do Cursor? | **Fora do MVP**; fica como pós-MVP (T18) | T18 |
| **P7** | Cursor sem CLI instalado? | **Igual ao Codex**: opcional, com nota discreta quando o `cursor-agent` não está instalado | T11, T12 |
| **P8** (2026-10-14) | Sem chave no app, usar a `CURSOR_API_KEY` do shell ou o login do `cursor-agent`? | **Não.** A credencial do Cursor vem **exclusivamente** da chave configurada na UI do gravita. Sem fallback para a `CURSOR_API_KEY` do shell nem para o login salvo do `cursor-agent`; o engine impede o fallback ativamente (D2). Sem chave: "chave não configurada", sessões bloqueadas, CTA para configurar — distinto de "CLI não instalado" (P7) | T01, T02, T03, T08, T09, T10, T11, T12, T13, T14, T17 |

## Perguntas em aberto

Nenhuma no momento.

## Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|-------|-------|---------|-----------|
| R1 | **Formato ACP do Cursor muda** entre versões do CLI (atualiza sozinho, versão = data) | Média | Alto | Versão mínima testada (`MIN_CURSOR_VERSION`); tipos ACP mínimos com fixtures por versão; mapper tolerante a campos desconhecidos; detector marca `outdated` |
| R2 | `CURSOR_API_KEY` no env **não** ser aceita pelo modo ACP, ou o CLI usar **outra** credencial (login salvo, `CURSOR_AUTH_TOKEN`) em vez da chave do app | Média | Alto | Env sem nenhuma `CURSOR_*`/`AGENT_CLI_*` herdada + `AGENT_CLI_CREDENTIAL_STORE=memory` (D2); T01 valida que o login salvo é ignorado. Se o mecanismo falhar, T09 fica bloqueada até escolher outra opção do T01 (não há fallback aceitável). Nunca passar `--api-key` em argv (vaza no `ps`) |
| R3 | Pedido de permissão do ACP sem dados suficientes para o `GuardedCall` | Média | Médio | Usar `kind`, `locations` e `rawInput`; na dúvida, `kind: "other"` (vai para o usuário) |
| R4 | Sessões ACP sem subagentes visíveis (mapa com uma linha só) | Alta | Baixo | Aceitável no MVP |
| R5 | Chave vazar em logs (`GRAVITA_DEBUG`, stderr do CLI), eventos ou argv | Baixa | Alto | Nunca logar env; mascarar a chave no stderr e nos eventos (T09); teste com chave sentinela (T13) |
| R6 | Herdar variáveis de um Cursor pai (ou do shell) quando o engine roda dentro do Cursor — credencial ou endpoint que não são os do app | Média | Alto | Nenhuma variável `CURSOR_*`/`AGENT_CLI_*` é herdada pelo `cursor-agent` (nem do shell de login, nem do `process.env` do engine); o env é sempre passado explícito no spawn; teste de compliance (T13) |
| R7 | Termos de uso da Cursor sobre clientes que dirigem o CLI | Baixa | Alto | CLI do usuário, sem empacotar nem falsificar identidade (`clientInfo: gravita`); revisar termos no T02 |
| R8 | ACP grava em `~/.cursor/acp-sessions` (estado do próprio Cursor) | Certa | Baixo | Documentar no `COMPLIANCE.md`; o gravita não lê esses arquivos |
| R9 | Ternários binários não migrados tratam Cursor como Claude | Média | Médio | T05 com lista exaustiva + grep no PR |
| R10 | Chats Cursor consomem a cota do usuário sem o gravita mostrar uso | Média | Baixo | Mostrar uso/custo se o ACP expuser; senão, documentar |
| R11 | **Mudança no contrato de compliance**: hoje o gravita promete nunca guardar credenciais | Certa | Alto | Exceção estreita e explícita só para a chave que o usuário cola (D6), aprovada no ADR 008 e publicada no `COMPLIANCE.md` **antes** do código (T02); testes que provam cada promessa (T13) |
| R12 | **Keychain**: prompts de acesso do macOS (ACL do item ligada ao binário), principalmente em builds de dev/não assinados e após atualizações | Média | Médio | O dono do item é o shell Tauri (binário assinado); testar no T01 com build de dev e assinado; mensagem clara se o acesso for negado |
| R13 | **A chave chega às ferramentas do agente**: o `cursor-agent` pode repassar seu env aos comandos de shell que executa, e um `env`/`printenv` poria a chave na saída da ferramenta (e no preview gravado em eventos) | Média | Alto | T01 verifica se o CLI filtra o env dos comandos; o runtime **mascara o valor exato da chave** em todo texto antes de virar evento (T07/T09); teste com sentinela |
| R14 | Chave trafegar pela webview/WebSocket | Baixa | Alto | A chave vai da tela direto para o shell Tauri (comando IPC), que a grava no Keychain e entrega ao engine **por stdin**; nenhum RPC do engine recebe ou devolve a chave; a webview nunca relê o valor salvo |
| R15 | Validação da chave fora do ar (sem rede) | Média | Baixo | Estado `unchecked` (salva assim mesmo, valida na próxima sessão); sessão que falha por auth marca `invalid` |
| R16 | **O CLI persiste credenciais derivadas da chave**: com a credencial padrão do macOS, o `cursor-agent` troca a API key por tokens e grava tokens **e a própria chave** no Keychain dele (`cursor-access-token`, `cursor-refresh-token`, `cursor-api-key`), sobrescrevendo o login do usuário; "Remover chave" no gravita não apagaria essa cópia | Alta (lido no bundle `2026.10.14`) | Alto | `AGENT_CLI_CREDENTIAL_STORE=memory` em todo processo `cursor-agent` do gravita (D2); T01 confirma que nada é gravado; roteiro manual em `docs/cursor.md` a cada CLI novo |
| R17 | `AGENT_CLI_CREDENTIAL_STORE` é **interno/não documentado** e pode mudar ou sumir numa atualização do CLI (que se atualiza sozinho) | Média | Alto | `MIN_CURSOR_VERSION` testado; registrar no ADR 008 a dependência; roteiro manual por versão; se sumir, bloquear o provider (status `outdated`/indisponível) até haver outro isolamento — nunca cair no login salvo |
