# Drone Brief: @memory for BRE-440

Mind pane ID (for sending completion signal): %31042

## Tasks assigned to you

- [ ] T001 @memory Add `warmSession(mindName)` to `minds/memory/lib/index.ts` — wraps `syncIndex(mindName)`, idempotent (no-op if already warm via module-level `Set<string>`), logs timing via `performance.now()` — produces: warmSession() at minds/memory/lib/index.ts
- [ ] T002 @memory Add warmSession tests to `minds/memory/lib/index.test.ts` — test: creates index if missing, idempotent (second call is no-op), re-syncs after file change
- [ ] T003 @memory [P] Create `minds/memory/lib/hygiene-cli.ts` — CLI wrapper calling `promoteToMemoryMd()` and `pruneStaleEntries()` from hygiene.ts. Flags: `--mind <name>` (required), `--promote <entry>` (repeatable), `--prune` (boolean). Matches `provision-cli.ts`/`search-cli.ts` pattern: bun shebang, `parseArgs()`, contextual error messages, `process.exit(1)` on bad input
- [ ] T004 @memory [P] Add `warm session` intent handler to `minds/memory/server.ts` — imports warmSession from index.ts, handles `"warm session"` intent with `context.mindName`
- [ ] T005 @memory Add `warmSession` to `exposes` array in `minds/memory/server.ts` — update the `createMind({ exposes: [...] })` config
- [ ] T006 @memory Run registry generation (`bun minds/generate-registry.ts`) and verify `minds.json` contains `memory` entry with correct `name`, `domain`, `owns_files`, `capabilities`, `exposes` (including new `warmSession`). Fix `minds/memory/server.ts` export format if Memory Mind does not appear

## Interface contracts

- Produces: warmSession() at minds/memory/lib/index.ts
- Consumes: (none — self-contained within @memory)

## Acceptance criteria

- All tasks marked [X] in tasks.md
- All produced interfaces exported at their declared paths
- `bun test` passes with no failures
- No files modified outside your owned paths (minds/memory/)

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
bun minds/lib/tmux-send.ts %31042 "DRONE_COMPLETE @memory BRE-440"
```

This sends the signal directly to the Mind's pane. Do NOT just type the signal — you must run this command.
