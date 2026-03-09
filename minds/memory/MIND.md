# @memory Mind Profile

## Domain

The Memory Mind owns all per-Mind memory infrastructure: provisioning memory directories, writing daily logs, curating MEMORY.md files, indexing content for search, and hygiene (promotion + pruning). Every other Mind's `minds/{name}/memory/` directory is managed exclusively by this Mind.

## Conventions

- **Per-Mind memory structure**: `minds/{name}/memory/MEMORY.md` (curated truths, always loaded) + `minds/{name}/memory/YYYY-MM-DD.md` (daily append-only logs).
- **Memory Mind owns ALL code**: All memory logic lives in `minds/memory/lib/`. Other Minds receive data directories only.
- **Memory is Mind-only**: Drones do NOT get memory access. Memory belongs to the Mind's institutional knowledge layer.
- **Provisioning is idempotent**: `provisionMind()` and `provisionAllMinds()` skip already-provisioned Minds — safe to call repeatedly.
- **Path construction goes through `paths.ts`**: `memoryDir()`, `memoryMdPath()`, `dailyLogPath()` — never inline `minds/{name}/memory/...`.
- **Search is scoped**: `searchMemory()` is always scoped to a single Mind's memory dir — never cross-Mind search.
- **Save trigger**: Minds flush to their daily log after review cycle completion via `write-cli.ts` — not on token threshold.
- **Hybrid search**: `searchMemory()` auto-creates the best available provider (OpenAI → local → null) and runs BM25 + vector cosine similarity. Falls back silently to BM25-only when no provider is configured.
- **L2 normalization**: All embedding vectors are normalized before storage and before comparison. `l2Normalize()` in `embeddings.ts` is the single utility — never inline normalization.
- **Embedding storage**: BLOB column in `chunks` table (Float32, 4 bytes/dim). Existing rows are NULL; backfilled on next `syncIndex()` call with a provider.
- **Provider fallback chain order**: OpenAI (OPENAI_API_KEY) → local node-llama-cpp (LLAMA_MODEL_PATH) → null (BM25-only). Never reverse this order.
- **Lazy loading**: Local provider does not load the GGUF model until first `embedQuery()` call.

## Key Files

- `minds/memory/lib/paths.ts` — `memoryDir()`, `memoryMdPath()`, `dailyLogPath()`
- `minds/memory/lib/provision.ts` — `provisionMind()`, `provisionAllMinds()`
- `minds/memory/lib/write.ts` — `appendDailyLog()`, `updateMemoryMd()`
- `minds/memory/lib/index.ts` — `createIndex()`, `syncIndex(mindName, provider?)` (SQLite + FTS5 + embedding BLOB column); `embeddingToBlob()`, `blobToEmbedding()` for Float32 serialization
- `minds/memory/lib/search.ts` — `searchMemory()` — hybrid BM25 + vector cosine similarity; falls back to BM25-only when no provider available
- `minds/memory/lib/embeddings.ts` — `EmbeddingProvider` interface, `l2Normalize()`, `createEmbeddingProvider()` auto-fallback factory (OpenAI → local → null)
- `minds/memory/lib/embeddings-openai.ts` — `OpenAIEmbeddingProvider`: `text-embedding-3-small` via fetch(), reads `OPENAI_API_KEY`
- `minds/memory/lib/embeddings-local.ts` — `LocalEmbeddingProvider`: node-llama-cpp GGUF, lazy-loaded, reads `LLAMA_MODEL_PATH` env
- `minds/memory/lib/hybrid.ts` — `mergeHybridResults()`: weighted 70-30 vector-text scoring, `bm25RankToScore()`, `applyTemporalDecay()`, `mmrRerank()`
- `minds/memory/lib/hygiene.ts` — `promoteToMemoryMd()`, `pruneStaleEntries()`
- `minds/memory/lib/provision-cli.ts` — CLI: `bun minds/memory/lib/provision-cli.ts [--mind <name>]`
- `minds/memory/lib/search-cli.ts` — CLI: `bun minds/memory/lib/search-cli.ts --mind <name> --query <text>`
- `minds/memory/lib/write-cli.ts` — CLI: `bun minds/memory/lib/write-cli.ts --mind <name> --content <text>`

## Anti-Patterns

- Inline path construction like `minds/${name}/memory/MEMORY.md` — always use `memoryMdPath()`.
- Drones writing directly to memory — only the Mind writes memory (via post-review flush).
- Cross-Mind search — `searchMemory()` takes a `mindName` and is always scoped.
- Implementing memory utilities outside `minds/memory/lib/` — this is the single-owner module.
- Duplicating chunking or FTS5 logic — `index.ts` is the sole location.
- Inline L2 normalization — always use `l2Normalize()` from `embeddings.ts`.
- Calling OpenAI API directly — use `OpenAIEmbeddingProvider` which handles auth, error context, and normalization.
- Loading the local GGUF model at module import time — `LocalEmbeddingProvider` must remain lazy-loaded.

## Review Focus

- Zero inline memory path construction across all files in this Mind.
- Provisioning is always idempotent — verify test coverage for repeated provisioning.
- `searchMemory()` always receives a `mindName` parameter — no global search paths.
- Daily logs are append-only — write functions never overwrite existing log content.
- All CLI entry points parse args deterministically and emit clear error messages with context.
- L2 normalization applied to all vectors before storage (in providers) and before comparison (already stored).
- Fallback chain order is correct: OpenAI first, local second, null third — check `createEmbeddingProvider()`.
- Graceful degradation: `searchMemory()` must never throw when no provider is available; returns BM25-only results.
