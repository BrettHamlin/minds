# Memory Mind — Curated Memory

## Architecture Decisions

- Per-Mind memory structure: `minds/{name}/memory/MEMORY.md` (curated truths) + `minds/{name}/memory/YYYY-MM-DD.md` (daily append-only logs).
- SQLite + FTS5 for keyword search (BM25 ranking). Vector embeddings layered on top for semantic search.
- Chunking: ~400 tokens per chunk, 80-token overlap to preserve context across boundaries.
- Provisioning is always idempotent — safe to call `provisionAllMinds()` repeatedly without duplicating directories.
- Memory is Mind-only. Drones are ephemeral and do not receive memory access.

## Key Conventions

- All path construction uses `paths.ts` exports — never inline `minds/{name}/memory/...`.
- `searchMemory()` is always scoped to a single `mindName` — never performs cross-Mind search.
- Daily logs are append-only. `appendDailyLog()` never truncates or overwrites existing content.
- Save trigger: Mind flushes to daily log after review cycle completion via `write-cli.ts` — not on token threshold.

## Interface Contracts

- `memoryDir(mindName)` → `minds/{mindName}/memory`
- `memoryMdPath(mindName)` → `minds/{mindName}/memory/MEMORY.md`
- `dailyLogPath(mindName, date)` → `minds/{mindName}/memory/YYYY-MM-DD.md`
- `provisionMind(mindName)` → creates dir + seeds MEMORY.md, idempotent
- `provisionAllMinds(mindsDir?)` → provisions all Minds found in minds/ dir
- `appendDailyLog(mindName, content, date?)` → appends to today's daily log
- `updateMemoryMd(mindName, content)` → replaces MEMORY.md content
- `createIndex(mindName)` → creates SQLite + FTS5 table for a Mind
- `syncIndex(mindName)` → re-indexes all markdown files in a Mind's memory dir
- `searchMemory(mindName, query, opts?)` → returns ranked snippets with path + line range
- `promoteToMemoryMd(mindName, entries)` → moves insights from daily logs to MEMORY.md
- `pruneStaleEntries(mindName)` → removes outdated entries from MEMORY.md
