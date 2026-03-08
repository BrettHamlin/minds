# Drone Brief: @memory for BRE-439

Mind pane ID (for sending completion signal): %30788

## Tasks assigned to you

Execute these in order. T004 and T005 are mutually exclusive — the spike (T001) determines which one you build.

### Phase 0: node-llama-cpp Compatibility Spike

- [X] T001 @memory Spike: test node-llama-cpp on Bun with EmbeddingGemma 300M GGUF in `minds/memory/lib/spike-llama.ts` — install `node-llama-cpp`, download model, embed a test string, verify no segfaults or Bun incompatibilities. Result determines T004 vs T005. **RESULT: PASS** (384-dim embeddings, exit 0)

**Decision gate after T001:**
- **node-llama-cpp works** → T004 builds node-llama-cpp provider, skip T005 entirely
- **node-llama-cpp fails on Bun** → T005 builds Ollama provider instead, skip T004

### Embedding Provider Interface

- [X] T002 @memory Create `EmbeddingProvider` interface and auto-fallback factory in `minds/memory/lib/embeddings.ts` — `embedQuery(text): Promise<number[]>`, `embedBatch(texts): Promise<number[][]>`, `createEmbeddingProvider()` with fallback chain (OpenAI → local → null), L2 normalization utility

### Provider Implementations

- [X] T003 @memory Create OpenAI provider in `minds/memory/lib/embeddings-openai.ts` — `text-embedding-3-small` via `fetch()` to OpenAI API, reads `process.env.OPENAI_API_KEY`, 8192 token limit, L2 normalization on output
- [X] T004 @memory Create node-llama-cpp provider in `minds/memory/lib/embeddings-local.ts` — EmbeddingGemma 300M GGUF, lazy-loaded, model path resolution, L2 normalization on output. **Only if T001 passes.**
- [SKIP] T005 @memory Create Ollama provider in `minds/memory/lib/embeddings-ollama.ts` — HTTP to localhost:11434 embeddings endpoint, model `embeddinggemma`, L2 normalization, batch via Promise.all over singles. **Only if T001 fails** (replaces T004).

### Hybrid Merge Algorithm

- [X] T006 @memory Create hybrid merge in `minds/memory/lib/hybrid.ts` — `mergeHybridResults()` with weighted scoring (default 70-30 vector-text), `bm25RankToScore()` normalization, optional temporal decay (halfLifeDays=90), optional MMR re-ranking (lambda=0.5)

### Integration with Existing Memory System

- [X] T007 @memory Extend `chunks` table in `minds/memory/lib/index.ts` — add `embedding BLOB` column via `ALTER TABLE` (NULL for existing rows), `syncIndex()` generates embeddings when provider available
- [X] T008 @memory Update `searchMemory()` in `minds/memory/lib/search.ts` — run FTS5 query + vector cosine similarity when provider available, merge via `mergeHybridResults()`, fall back to BM25-only when no provider

### Tests

- [X] T009 @memory [P] Create `minds/memory/lib/embeddings.test.ts` — tests for provider creation, fallback chain order, L2 normalization correctness, graceful degradation when no providers available
- [X] T010 @memory [P] Create `minds/memory/lib/hybrid.test.ts` — tests for merge algorithm (weighted scoring, score ordering), bm25RankToScore normalization, temporal decay, MMR re-ranking, edge cases (empty results, single source)
- [X] T011 @memory Extend `minds/memory/lib/index.test.ts` — tests for embedding column creation, syncIndex with and without provider, NULL embeddings for existing rows
- [X] T012 @memory Extend `minds/memory/lib/search.test.ts` — tests for hybrid search results, BM25-only fallback, score ordering with mixed sources

### Documentation

- [X] T013 @memory Update `minds/memory/MIND.md` — add embedding files to Key Files, add hybrid search conventions, update search.ts description. Delete spike file if present.

## OpenClaw Reference

The ticket references OpenClaw's implementation. Key patterns to match:

- **L2 normalization**: All vectors normalized before storage and comparison
- **Provider fallback**: Auto-select best available, graceful degradation to BM25-only
- **Hybrid merge**: `score = vectorWeight * vectorScore + textWeight * textScore`, then temporal decay, then optional MMR
- **Cosine similarity**: Computed in TypeScript, not SQLite (dataset per Mind is small)
- **Lazy init**: Don't load heavy providers until first search/sync needs them
- **No migration needed**: Existing rows get NULL embeddings, backfilled on next syncIndex

## Acceptance criteria

- All tasks marked [X] in tasks.md
- `bun test` passes with no failures
- No files modified outside `minds/memory/`
- Graceful degradation verified — no errors when no provider configured

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks marked [X]
- [ ] No files modified outside minds/memory/
- [ ] No duplicated logic (check against existing codebase)
- [ ] All new functions have tests
- [ ] All tests pass (`bun test`)
- [ ] No lint errors
- [ ] No hardcoded values that should be config
- [ ] Error messages include context (not just "failed")
- [ ] L2 normalization applied to all vectors before storage
- [ ] Fallback chain order is correct (OpenAI → local → BM25-only)

Do NOT commit your changes. The Mind will handle committing and merging after review passes.

When all tasks are complete and the checklist passes, send completion signal to the Mind:

```bash
bun minds/lib/tmux-send.ts %30788 "DRONE_COMPLETE @memory BRE-439"
```

This sends the signal directly to the Mind's pane. Do NOT just type the signal — you must run this command.
