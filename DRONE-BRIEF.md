# Drone Brief: @memory for BRE-438

Mind pane ID (for sending completion signal): %28675

## Tasks assigned to you

### Phase 1: Mind Bootstrap
- [ ] T001 @memory Create minds/memory/MIND.md — domain profile for the Memory Mind (memory provisioning, search, write, hygiene, indexing)
- [ ] T002 @memory Create minds/memory/server.ts — MCP server with describe() exposing capabilities (provision, search, write, hygiene) so generate-registry.ts discovers it
- [ ] T003 @memory Create minds/memory/memory/MEMORY.md — seed the Memory Mind's own memory directory (eats its own dog food)

### Phase 2: Core Library
- [ ] T004 @memory Create minds/memory/lib/paths.ts — deterministic path resolution for per-Mind memory dirs: memoryDir(mindName), memoryMdPath(mindName), dailyLogPath(mindName, date) — produces: memoryDir(), memoryMdPath(), dailyLogPath() at minds/memory/lib/paths.ts
- [ ] T005 @memory Create minds/memory/lib/paths.test.ts — unit tests for all path resolution functions
- [ ] T006 @memory Create minds/memory/lib/provision.ts — scan minds/ directory, create memory/ dir + seed MEMORY.md for any Mind missing one, idempotent — produces: provisionMind(), provisionAllMinds() at minds/memory/lib/provision.ts
- [ ] T007 @memory Create minds/memory/lib/provision.test.ts — unit tests: provision new Mind, skip already-provisioned, provision all, idempotent re-run
- [ ] T008 @memory Create minds/memory/lib/write.ts — appendDailyLog(mindName, content) appends to YYYY-MM-DD.md, updateMemoryMd(mindName, content) for curated updates — produces: appendDailyLog(), updateMemoryMd() at minds/memory/lib/write.ts
- [ ] T009 @memory Create minds/memory/lib/write.test.ts — unit tests: append creates file if missing, appends to existing, date stamp correctness, MEMORY.md update
- [ ] T010 @memory Create minds/memory/lib/index.ts — SQLite index management per Mind: createIndex(mindName), syncIndex(mindName), chunk markdown into ~400 token segments with 80-token overlap, store in SQLite with FTS5 — produces: createIndex(), syncIndex() at minds/memory/lib/index.ts
- [ ] T011 @memory Create minds/memory/lib/index.test.ts — unit tests: create index, sync after file change, chunking correctness, FTS5 availability
- [ ] T012 @memory Create minds/memory/lib/search.ts — searchMemory(mindName, query, opts?) with hybrid BM25 keyword + vector search, scoped to Mind's memory dir, returns ranked snippets with path + line range — produces: searchMemory() at minds/memory/lib/search.ts
- [ ] T013 @memory Create minds/memory/lib/search.test.ts — unit tests: keyword match, empty results, score filtering, maxResults, scoping to correct Mind
- [ ] T014 @memory Create minds/memory/lib/hygiene.ts — promoteToMemoryMd(mindName, entries) moves durable insights from daily logs to MEMORY.md, pruneStaleEntries(mindName) removes outdated entries — produces: promoteToMemoryMd(), pruneStaleEntries() at minds/memory/lib/hygiene.ts
- [ ] T015 @memory Create minds/memory/lib/hygiene.test.ts — unit tests: promote adds to MEMORY.md, prune removes, idempotent

### Phase 3: CLI Entry Points
- [ ] T016 @memory Create minds/memory/lib/provision-cli.ts — CLI wrapper: `bun minds/memory/lib/provision-cli.ts [--mind <name>]` provisions one or all Minds
- [ ] T017 @memory Create minds/memory/lib/search-cli.ts — CLI wrapper: `bun minds/memory/lib/search-cli.ts --mind <name> --query <text>`
- [ ] T018 @memory Create minds/memory/lib/write-cli.ts — CLI wrapper: `bun minds/memory/lib/write-cli.ts --mind <name> --content <text>` appends to daily log

### Phase 4: Integration (Mind-only — drones do NOT get memory access)
- [ ] T019 @memory Update minds/STANDARDS.md — add "Memory Flush on Completion" section: after a Mind completes its review cycle, it writes learnings to its own daily log via `bun minds/memory/lib/write-cli.ts`. This is a Mind responsibility, not a drone responsibility.
- [ ] T020 @memory Run provisionAllMinds() to create memory/ directories for all existing Minds (scans minds/ directory dynamically, skips already-provisioned)

## Key design context

This is a NEW Mind — all code is new. Based on OpenClaw memory architecture:
- **Per-Mind memory structure**: Each Mind gets `minds/{name}/memory/MEMORY.md` (curated truths, always loaded) + `minds/{name}/memory/YYYY-MM-DD.md` (daily append-only logs)
- **Memory Mind owns ALL code**: All memory logic lives in `minds/memory/lib/`. Other Minds just get data directories.
- **Memory is Mind-only**: Drones do NOT get memory access. Mind has institutional knowledge. Drones are ephemeral.
- **Hybrid search**: BM25 keyword (FTS5) + vector embeddings, scoped per Mind, SQLite-backed
- **Save trigger**: Mind-level flush after review cycle completion (not token-threshold based)
- **Provisioning**: Create memory/ dir + seed MEMORY.md for any Mind, idempotent, dynamic Mind discovery (scan minds/ dir)

## Reference: Existing Mind patterns

Look at other Minds for patterns:
- `minds/pipeline_core/server.ts` — example MCP server with describe()
- `minds/pipeline_core/MIND.md` — example domain profile structure
- `minds/STANDARDS.md` — engineering standards all Minds follow
- `minds/lib/` — shared Mind utilities (NOT your code — your code goes in minds/memory/lib/)

## Interface contracts

- Produces: memoryDir(), memoryMdPath(), dailyLogPath() at minds/memory/lib/paths.ts
- Produces: provisionMind(), provisionAllMinds() at minds/memory/lib/provision.ts
- Produces: searchMemory() at minds/memory/lib/search.ts
- Produces: appendDailyLog(), updateMemoryMd() at minds/memory/lib/write.ts
- Produces: promoteToMemoryMd(), pruneStaleEntries() at minds/memory/lib/hygiene.ts
- Produces: createIndex(), syncIndex() at minds/memory/lib/index.ts
- Consumes: nothing external (self-contained new Mind)

## Acceptance criteria

- All tasks marked [X] in tasks.md
- All produced interfaces exported at their declared paths
- `bun test` passes with no failures
- No files modified outside minds/memory/

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks marked [X]
- [ ] No files modified outside owns_files (minds/memory/)
- [ ] No duplicated logic (check against existing codebase)
- [ ] All new functions have tests
- [ ] All tests pass (`bun test`)
- [ ] No lint errors
- [ ] Interface contracts honored (produces/consumes match declarations)
- [ ] No hardcoded values that should be config
- [ ] Error messages include context (not just "failed")

Do NOT commit your changes. The Mind will handle committing and merging after review passes.

When all tasks are complete and the checklist passes, send completion signal to the Mind:

```bash
bun minds/lib/tmux-send.ts %28675 "DRONE_COMPLETE @memory BRE-438"
```

This sends the signal directly to the Mind's pane. Do NOT just type the signal — you must run this command.
