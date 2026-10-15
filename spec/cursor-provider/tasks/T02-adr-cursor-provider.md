# T02 — ADR 008 e exceção de credencial no `COMPLIANCE.md`

- **Status:** review (implementado e verificado localmente em 2026-10-14; não commitado, sem PR)
- **Fase:** 0 — Validação
- **Dependências:** T01
- **Estimativa:** M

## Objetivo

Registrar a decisão arquitetural de integrar o Cursor via `cursor-agent acp` e **publicar a
exceção estreita de credencial** (chave da API configurada na UI) antes de qualquer código
que guarde a chave.

## Contexto

Decisões D1–D7 em `../00-overview.md`, respostas P1–P8 em `../riscos-e-perguntas.md`.
Hoje o `docs/COMPLIANCE.md` promete "never reads, stores or forwards credentials"; P1
exige guardar a chave do Cursor no Keychain — sem ADR e texto novo, isso contradiz o
contrato público (R11).

## Arquivos afetados

- `docs/adr/008-cursor-provider.md` _novo_ (em inglês, como os demais ADRs)
- `docs/adr/006-clean-architecture.md` (adendo curto "the Cursor runtime")
- `docs/COMPLIANCE.md` (nova seção "Cursor API key")
- `README.md` (frases de compliance que falam em "credentials")

## Plano de conteúdo do ADR 008

1. **Contexto:** pedido de usar a assinatura Cursor via API key; o que Claude/Codex fazem hoje.
2. **Decisão — transporte (D1, P2):** `cursor-agent acp` instalado pelo usuário, um
   processo por sessão, process group próprio, ids `cursor:`; SDK e Cloud Agents não usados.
3. **Decisão — modos (D3, P3):** só `agent | plan | ask`; aprovações via `PermissionBroker`;
   sem acesso total/`--force`.
4. **Decisão — modelos (D5, P4):** Auto padrão + modelos da sessão.
5. **Decisão — credencial (D2, D6, P1, P8):** chave colada na UI, Keychain pelo shell
   Tauri, entrega por stdin, injeção só no env do `cursor-agent`, máscara em eventos,
   remoção. **Fonte única, sem fallback:** a `CURSOR_API_KEY` do shell e o login salvo do
   `cursor-agent` nunca são usados; o env do `cursor-agent` não herda `CURSOR_*`/
   `AGENT_CLI_*`, recebe a chave explícita e `AGENT_CLI_CREDENTIAL_STORE=memory` (ou o
   mecanismo escolhido no T01); `CURSOR_API_ENDPOINT` não é repassado (justificativa no
   D2). Registrar a dependência de variável interna do CLI (R17).
6. **Fora de escopo (D7, P5, P6, P7):** squads cancelado; sessões externas pós-MVP;
   Cursor opcional como Codex.
7. **Alternativas rejeitadas:** `@cursor/sdk`, `-p stream-json`, Cloud Agents; guardar a
   chave em arquivo/SQLite; enviar a chave pelo WebSocket; passar `--api-key` em argv;
   fallback para `CURSOR_API_KEY` do shell ou para o login do `cursor-agent` (P8);
   `HOME` temporário como isolamento padrão (quebra `~/.cursor`, git e SSH — T01).
8. **Consequências:** novo pacote `adapter-cursor`; primeira credencial guardada pelo
   gravita; testes de compliance novos (T13); dependência de Keychain no shell Tauri.

## Texto da exceção no `COMPLIANCE.md` (rascunho a refinar no PR)

> **Cursor API key (exception).** If you paste a Cursor API key into gravita, it is stored
> only in your macOS Keychain, never written to gravita's database, logs or files, never
> shown again in the UI, never sent anywhere except as `CURSOR_API_KEY` in the environment
> of the `cursor-agent` processes gravita starts for you, and masked in any agent output
> gravita records. "Remove key" deletes it from the Keychain. This key is the only Cursor
> credential gravita uses: it never forwards a `CURSOR_API_KEY` from your shell, never
> relies on a saved `cursor-agent login`, and runs `cursor-agent` so that it neither reads
> nor overwrites your saved Cursor login. Without a key, Cursor sessions don't start.
> Claude and Codex credentials are still never read, stored or forwarded.

## Passos

1. Escrever o ADR conforme o plano acima, com os achados do T01.
2. Atualizar `COMPLIANCE.md` e README com a exceção (marcar "from version X").
3. Revisar termos de uso da Cursor quanto a clientes que dirigem o CLI (R7).
4. Adendo no ADR 006 apontando para o 008.
5. Listar no ADR cada promessa da exceção e o teste que a cobre (T13).

## Critérios de aceite

- ADR "Accepted" e mergeado **antes** de T17.
- `COMPLIANCE.md` e README sem contradição com P1.
- `00-overview.md` atualizado se alguma decisão mudou após o T01.

## Como testar

Revisão no PR; conferir que os links entre ADR 006, ADR 008, `COMPLIANCE.md` e `spec/`
resolvem.

## Notas de execução

- `docs/adr/008-cursor-provider.md` (transporte `cursor-agent acp`, credencial só da UI,
  isolamento por `AGENT_CLI_CREDENTIAL_STORE=memory`, sem `authenticate`, sem full access).
- `docs/COMPLIANCE.md` seção "Cursor API key (exception)", publicada antes do código que
  guarda a chave; revisada no T13 (nada de `~/.cursor`, a UI nunca lê a chave de volta,
  quando o `cursor-agent models` roda, lista de testes).
- Adendo no ADR 006 (o engine guarda a chave só em memória; a porta `CredentialSource`).
