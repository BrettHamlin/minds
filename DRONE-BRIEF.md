# Drone Brief: @clarify for BRE-441

Mind pane ID (for sending completion signal): %30788

## Tasks assigned to you

- [ ] T001 @clarify Create `minds/clarify/lib/memory-query.ts` with `queryMemoryForAmbiguity()` function and `MemoryMatch` type — produces: queryMemoryForAmbiguity() at minds/clarify/lib/memory-query.ts
- [ ] T002 @clarify Add graceful degradation to `minds/clarify/lib/memory-query.ts` — return empty results when Mind memory directory does not exist (first run) instead of throwing
- [ ] T003 @clarify Add tests for `minds/clarify/lib/memory-query.ts` — cover: direct match (score above 0.7), partial match (0.3 to 0.7), no match, empty memory graceful degradation, hybrid search invocation
- [ ] T004 @clarify Update `src/commands/collab.clarify.md` — insert memory query step between steps 6 and 7: for each ambiguity from step 6, run `bun minds/clarify/lib/memory-query-cli.ts` to check prior decisions, skip questions with direct matches (cite prior decision), strengthen recommendations with partial matches
- [ ] T005 @clarify Update `src/commands/collab.clarify.md` — add memory write step after step 9: after integrating answers, write decisions to clarify daily log via CLI
- [ ] T006 @clarify Update `src/commands/collab.clarify.md` — update recommendation grounding priority in step 7 to: (1) prior clarification decision from memory, (2) codebase convention from scan, (3) generic best practice
- [ ] T007 @clarify Update `minds/clarify/MIND.md` — add memory integration to key files table, conventions for structured write format, anti-patterns for not checking memory before generating questions, and review focus for memory query and graceful empty-memory handling

## Implementation Details

### T001: memory-query.ts

Create `minds/clarify/lib/memory-query.ts` that wraps `searchMemory()` from `minds/memory/lib/search.ts`.

Key design:
- `queryMemoryForAmbiguity(mindName: string, ambiguityDescription: string): Promise<MemoryMatch[]>`
- Import `searchMemory` from `../../memory/lib/search.js` and `SearchResult` type
- Call `searchMemory(mindName, ambiguityDescription, { maxResults: 5 })`
- Classify each result:
  - `direct` — score > 0.7 AND content directly answers the ambiguity (Q/A format match)
  - `partial` — score 0.3–0.7 OR content is related but doesn't fully answer
  - `none` — score < 0.3, filtered out (don't return)
- `MemoryMatch` type: `{ result: SearchResult, classification: 'direct' | 'partial', score: number }`

### T002: Graceful degradation

`searchMemory()` throws when the memory dir doesn't exist. Wrap the call in try/catch:
- Catch the "memory directory does not exist" error
- Return empty array `[]` (not an error)
- Log a debug message: "No memory found for mind {mindName}, proceeding without memory context"

### T003: Tests

Create `minds/clarify/lib/memory-query.test.ts`. Mock `searchMemory` using Bun's test mocking.

### T004: Memory query step in collab.clarify.md

Insert a new step **6b** (between current steps 6 and 7) titled "Memory Query":
- For each ambiguity detected in step 6 scan, before generating questions:
  1. Search: `bun minds/memory/lib/search-cli.ts --mind clarify --query "<ambiguity description>"`
  2. Parse JSON results
  3. If a result has high score (> 0.7) and content contains `Q:` and `A:` format matching the ambiguity → mark as "skip" (cite prior decision in spec update)
  4. If a result has moderate score (0.3–0.7) → use as evidence to strengthen recommendation
  5. If no results → proceed as before (codebase-grounded recommendation)

### T005: Memory write step in collab.clarify.md

After step 9 (integrate answers), add step 9b:
- For each answered question, write to clarify Mind's daily log:
  ```bash
  bun minds/memory/lib/write-cli.ts --mind clarify --content "{TICKET_ID}: Q: <question> → A: <answer>. Reasoning: <why>. Codebase evidence: <files cited>."
  ```

### T006: Recommendation grounding priority

In step 7 (Generate Questions), update the recommendation grounding to:
1. **Prior clarification decision** (strongest — explicit human choice from memory)
2. **Codebase convention** (current — pattern observed in code)
3. **Generic best practice** (weakest — fallback)

### T007: MIND.md updates

Add to Key Files table:
- `minds/clarify/lib/memory-query.ts` — Memory search wrapper for ambiguity matching
- `minds/memory/lib/search-cli.ts` — CLI for hybrid memory search (consumed, not owned)
- `minds/memory/lib/write-cli.ts` — CLI for writing to daily log (consumed, not owned)

Add to Conventions:
- Memory writes use structured format: `{TICKET}: Q: <q> → A: <a>. Reasoning: <r>. Codebase evidence: <e>.`

Add to Anti-Patterns:
- Generating questions without checking memory first → redundant questions across pipeline runs
- Skipping memory write after integrating answers → future runs can't benefit

Add to Review Focus:
- Memory query happens before question generation (not after)
- Graceful degradation when memory is empty (no errors on first run)
- Prior decisions cited when skipping questions or strengthening recommendations

## Interface contracts

- Produces: queryMemoryForAmbiguity() at minds/clarify/lib/memory-query.ts
- Consumes (pre-existing, do NOT reimplement):
  - searchMemory() from minds/memory/lib/search.ts (hybrid BM25 + vector search)
  - SearchResult, SearchOptions types from minds/memory/lib/search.ts
  - write-cli.ts at minds/memory/lib/write-cli.ts (CLI: --mind --content)
  - search-cli.ts at minds/memory/lib/search-cli.ts (CLI: --mind --query)

## Acceptance criteria

- All tasks marked [X] in tasks.md
- All produced interfaces exported at their declared paths
- `bun test` passes with no failures
- No files modified outside your owned paths (minds/clarify/ and src/commands/collab.clarify.md)

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks marked [X]
- [ ] No files modified outside owns_files
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
bun minds/lib/tmux-send.ts %30788 "DRONE_COMPLETE @clarify BRE-441"
```

This sends the signal directly to the Mind's pane. Do NOT just type the signal — you must run this command.
