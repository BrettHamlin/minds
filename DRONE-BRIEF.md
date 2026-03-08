# Drone Brief: @observability for BRE-432

Mind pane ID (for sending completion signal): %34064

## Tasks assigned to you

- [ ] T001 @observability Add `durationFormatted` field to `ClassifyRunResult` in `minds/observability/classify-run-lib.ts` — produces: `durationFormatted` field on `ClassifyRunResult` at `minds/observability/classify-run-lib.ts`
- [ ] T002 @observability Add `formatDuration()` helper to `minds/observability/classify-run-lib.ts` that converts ms to human-readable string (e.g., "2m 30s", "1h 5m") — produces: `formatDuration()` at `minds/observability/classify-run-lib.ts`
- [ ] T003 @observability Update `classifyRun()` in `minds/observability/classify-run-lib.ts` to populate `durationFormatted` using `formatDuration()`
- [ ] T004 @observability Add unit tests for `formatDuration()` in `minds/observability/classify-run.test.ts` — edge cases: null, 0, sub-second, seconds, minutes, hours
- [ ] T005 @observability Add unit test verifying `classifyRun()` returns `durationFormatted` string in `minds/observability/classify-run.test.ts`
- [ ] T006 @observability Update CLI integration test in `minds/observability/classify-run.test.ts` to assert `durationFormatted` is present in JSON output
- [ ] T007 @observability Verify all existing tests pass with `bun test minds/observability/`

## Context

- `durationMs` computation already exists in `classify-run-lib.ts` (lines 54-70) — computes from `started_at`/`completed_at` timestamps
- Dashboard already formats duration via `fmtDuration()` in `metrics-dashboard.ts` — do NOT duplicate that function; `formatDuration()` in classify-run-lib.ts is for the CLI output
- Statusline already shows elapsed time for active pipelines via `formatElapsed()` in `statusline.ts`
- `classify-run.ts` CLI output (line 56) already includes raw `durationMs` — this ticket adds `durationFormatted` alongside it

## Interface contracts

- Produces: `durationFormatted` field on `ClassifyRunResult`, `formatDuration()` at `minds/observability/classify-run-lib.ts`
- Consumes: nothing (no cross-Mind dependencies)

## Acceptance criteria

- All tasks marked [X] in tasks.md
- All produced interfaces exported at their declared paths
- `bun test` passes with no failures
- No files modified outside your owned paths (`minds/observability/`)

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

When all tasks are complete and the checklist passes, send completion signal via the bus:

```bash
bun minds/transport/minds-publish.ts --channel minds-BRE-432 --type DRONE_COMPLETE --payload '{"mindName":"observability"}'
```

The bus URL is resolved automatically from `BUS_URL` env var or `.collab/bus-port`.
