# 003 — Deterministic ids and content-addressed idempotency keys

Status: accepted

## Decision
Every event carries a `key` derived only from the fact it describes (`tool:<toolUseId>:started`, `agent:<session>:<agent>:spawned`, …). The store inserts with `INSERT OR IGNORE`, so the same fact seen by several sources (SDK stream, transcript tailer, hooks) or re-read after a restart is stored once. Usage records, which Claude Code repeats per content block with growing output, are kept per message at their maximum.

The reducer is order-tolerant for structure (tree, terminal states, tokens), verified by property tests over shuffled and duplicated event streams.

## Consequences
Sources can overlap freely; re-indexing is safe; replays are exact.
