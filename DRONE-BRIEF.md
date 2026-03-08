You are the @observability drone for ticket BRE-432.

Domain: Pipeline metrics and analysis: recording gate decisions, run outcomes, autonomy rates, gate accuracy tracking, dashboard display, draft PR creation, and run classification.

Mind pane ID (for sending completion signal): %28421

Your file boundary (only touch files in these paths):
- minds/observability/

## Tasks assigned to you:

- [ ] T001 @observability Update `classifyRun()` in `minds/observability/classify-run-lib.ts` to compute `durationMs` from `started_at`/`completed_at` timestamps when `duration_ms` is NULL on the runs row, rather than only reading the pre-set value
- [ ] T002 @observability [P] Add new unit tests in `minds/observability/classify-run.test.ts` for duration computation: verify `classifyRun()` computes duration from timestamps when `duration_ms` is NULL, and preserves existing `duration_ms` when already set
- [ ] T003 @observability [P] Surface run duration in statusline output in `minds/observability/statusline.ts` — include elapsed time in the rendered status line when a pipeline is active
- [ ] T004 @observability Verify all existing tests pass after changes by running `bun test` in the repo root

Execute tasks in this order: T001 first (foundation), then T002+T003 (can be done together), then T004 (final verification).

## Interface contracts:

- Produces: None (no new cross-Mind interfaces)
- Consumes:
  - `pipeline_core/getRepoRoot` (already imported in existing code)
  - `pipeline_core/validateTicketIdArg` (already imported in existing code)
  - `transport/status-snapshot` PipelineSnapshot type (already imported in statusline.ts)

## Key context for each task:

### T001 — classifyRun() duration computation
Currently `classifyRun()` in `classify-run-lib.ts` reads `duration_ms` from the runs table. If `duration_ms` is NULL (e.g., `completeRun()` hasn't fired yet), it returns `null`. The AC requires classifyRun to **compute** the duration from `started_at` and the current time (or `completed_at` if set) when `duration_ms` is NULL, then stamp it on the runs row.

Look at how `completeRun()` in `metrics.ts` (lines 189-212) already does this computation — follow the same pattern but inside `classifyRun()`.

### T002 — New unit tests for duration
Add tests that verify:
1. When `duration_ms` is NULL but `started_at` is set, `classifyRun()` computes and returns a non-null `durationMs`
2. When `duration_ms` is already set (e.g., 4200), `classifyRun()` preserves that value (doesn't recompute)
3. The computed `duration_ms` is stamped on the runs row in the DB

### T003 — Statusline duration
Currently `statusline.ts` renders: `{ticketId} {phase} > {detail}`. Add elapsed duration to the output. The `PipelineSnapshot` type (from `transport/status-snapshot.ts`) may need to be checked for available fields. If duration info isn't in the snapshot, compute it from a timestamp field if available, or skip if no timing data is present in the snapshot.

### T004 — Final verification
Run `bun test` from the repo root. All tests must pass — no exceptions.

## Acceptance criteria:

- All tasks marked [X] in tasks.md
- `classifyRun()` computes duration from timestamps when `duration_ms` is NULL
- Duration is included in the classification output
- Statusline shows duration when available
- All new functions have tests
- `bun test` passes with no failures
- No files modified outside minds/observability/

## Review checklist (verify before reporting DRONE_COMPLETE):

- [ ] All tasks marked [X]
- [ ] No files modified outside owns_files
- [ ] No duplicated logic (check against existing codebase)
- [ ] All new functions have tests
- [ ] All tests pass (`bun test`)
- [ ] No lint errors
- [ ] Interface contracts honored (produces/consumes match declarations)
- [ ] No hardcoded values that should be config
- [ ] Error messages include context (not just "failed")
- [ ] Every DB open has a matching close (including error paths)
- [ ] Lib functions accept a `db` parameter — they do not open their own connection
- [ ] CLI scripts follow validate -> open -> call lib -> close -> exit pattern

Do NOT commit your changes. The Mind will handle committing and merging after review passes.

When all tasks are complete and the checklist passes, send completion signal to the Mind:

```bash
bun minds/lib/tmux-send.ts %28421 "DRONE_COMPLETE @observability BRE-432"
```

This sends the signal directly to the Mind's pane. Do NOT just type the signal — you must run this command.
