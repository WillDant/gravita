# Mapeamento sintético — gravita

## Estrutura principal

```text
gravita/
├── apps/
│   ├── desktop/          # Tauri + React (Vite)
│   │   └── src/
│   │       ├── app/              # App, router hash, providers
│   │       ├── features/         # home, project, session, squad, terminal, …
│   │       ├── infrastructure/   # WsEngineGateway, Tauri, tray, notifier
│   │       ├── state/            # zustand slices + engineSync
│   │       └── shared/           # ui, i18n, presenters, utils
│   └── engine/           # Bun sidecar
│       └── src/
│           ├── domain/           # políticas puras (chat, squad, permissions, …)
│           ├── application/      # ports, services, usecases
│           ├── infrastructure/   # sqlite, claude/, codex/, cursor/, credentials/, git, demo, terminal
│           ├── interface/rpc/    # router + transport (Bun.serve, /ws)
│           └── main/             # container.ts, args, main.ts
├── packages/
│   ├── protocol/         # GravitaEvent, RpcContract, squad, tools, ids
│   ├── core/             # reducer, projection, timeline, squad (sem I/O)
│   ├── orbs/             # orbit scene, glyphs, motion budget, palette
│   ├── adapter-claude/   # transcripts, hooks, SDK mapper
│   ├── adapter-codex/    # rollout, app-server JSON-RPC, protocol vendored
│   ├── adapter-cursor/   # cliente ACP (cursor-agent acp), mapper, tools
│   └── adapter-fake/     # demo scripted agents
├── plugins/deep-observe/ # plugin Claude Code (hooks observe-only)
├── fixtures/             # transcripts/RPC sintéticos para testes
├── docs/                 # guias + adr/
└── tools/                # build sidecar, vendor codex protocol, check-bundle
```

## Módulos críticos

| Caminho | Responsabilidade |
|---------|------------------|
| `packages/protocol` | Modelo de eventos normalizado (zod), contrato JSON-RPC, constantes de erro |
| `packages/core` | `GravitaState`, projeção, status, squad scheduler/validate, plan usage — testável sem rede |
| `packages/orbs` | Desenho Orbit (layout, paint, scene) e tokens visuais |
| `packages/adapter-claude` | Tail de transcript, normalização, hooks Deep Observe, mapeamento SDK |
| `packages/adapter-codex` | Leitura rollout, cliente app-server, mapper RPC ↔ mesmas chaves que rollout |
| `packages/adapter-cursor` | Cliente ACP do `cursor-agent`, mapper ACP → eventos (chave mascarada), nomes de ferramentas |
| `apps/engine/src/application/usecases/ingest-events.ts` | Único caminho de escrita: store → project → publish |
| `apps/engine/src/interface/rpc/router.ts` | Tabela método RPC → use case (tipada pelo contrato) |
| `apps/engine/src/main/container.ts` | Composition root — wiring de todas as fontes e runtimes |
| `apps/desktop/src/infrastructure/engine/WsEngineGateway.ts` | Cliente WS do UI para o engine |
| `apps/desktop/src/state/applyEvents.ts` | Aplica eventos na projeção local (structural sharing) |
| `apps/desktop/src/features/session/` | Vista sessão: mapa de linhas, painel agente, composer |

## Fluxo de dados (resumo)

```text
Claude transcript / Codex rollout / Hooks / Agent SDK runtime
        → adapters (pure map)
        → IngestEvents → SQLite + ProjectionService
        → EventBroadcaster (~33ms) → WebSocket → desktop applyEvents → UI
```

Controle (chat, permissões, squad): UI → RPC → use case → `SessionRuntime` / git / checks.

## Entrypoints

| Alvo | Comando | Notas |
|------|---------|--------|
| Dev UI + demo | `pnpm --filter @gravita/engine dev:demo` + `pnpm --filter @gravita/desktop dev` | Engine **4319**, UI **5173** |
| Dev real Claude | `pnpm --filter @gravita/engine dev` (sem `--demo`) | Observa `~/.claude` |
| Desktop nativo | `pnpm --filter @gravita/desktop tauri dev` | Requer Rust |
| Build monorepo | `pnpm build` | turbo `dist/**` |
| Testes | `pnpm test` | turbo, engine test depende de `^build` |
| Typecheck | `pnpm typecheck` | |
| Lint | `pnpm lint` / `pnpm format` | biome |

## Testes e fakes

- `apps/desktop/src/test/FakeGateway.ts` — gateway in-memory para testes de UI
- `packages/adapter-codex/testing` — app-server scriptado com fixtures `fixtures/codex-rpc/`
- `packages/adapter-cursor/testing` — servidor ACP roteirizado com fixtures `fixtures/cursor-acp/`
- `apps/engine/test/contracts/` — tabelas de contrato (ex.: guarded-call)
