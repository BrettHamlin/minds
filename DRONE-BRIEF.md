You are the @observability drone for ticket BRE-432.

Domain: Pipeline metrics and analysis: recording gate decisions, run outcomes, autonomy rates, gate accuracy tracking, dashboard display, draft PR creation, and run classification.

Your file boundary (only touch files in these paths):
- minds/observability/

Tasks assigned to you (execute sequentially):

- [ ] T001 @observability Add durationMs to ClassifyRunResult and classifyRun() in minds/observability/classify-run-lib.ts
- [ ] T002 @observability Add duration metric test in minds/observability/classify-run.test.ts
- [ ] T003 @observability Verify classify-run CLI outputs durationMs in minds/observability/classify-run.ts

Interface contracts:
- Produces: none (no cross-Mind interfaces created by this work)
- Consumes: pipeline_core/getRepoRoot, pipeline_core/validateTicketIdArg (existing, already imported — no changes needed)

## Task Details

### T001 — Add durationMs to ClassifyRunResult

File: minds/observability/classify-run-lib.ts

Update `ClassifyRunResult` interface to include `durationMs: number | null`. Update `classifyRun()` to read the `duration_ms` column from the `runs` table row and include it in the result. Note: `duration_ms` is already computed and stamped by `completeRun()` in `metrics.ts` — you just need to READ it.

Important: The `runs` table already has `started_at`, `completed_at`, and `duration_ms` columns (see schema in `metrics.ts`). Do NOT recompute duration — just read the existing `duration_ms` value from the row. If the row doesn't exist or `duration_ms` is NULL, return `durationMs: null`.

### T002 — Add duration metric test

File: minds/observability/classify-run.test.ts

Add test cases in a new describe block:
1. Run with `duration_ms` set on the runs row -> `classifyRun()` returns the correct `durationMs` value
2. Run with no `duration_ms` (null) -> `classifyRun()` returns `durationMs: null`
3. CLI integration test verifies `durationMs` appears in JSON output (add to existing CLI integration describe block)

### T003 — Verify CLI output includes durationMs

File: minds/observability/classify-run.ts

The CLI at line 56 does `console.log(JSON.stringify({ ...result, autonomyRates }))` which spreads the `classifyRun()` result. Since T001 adds `durationMs` to `ClassifyRunResult`, it will automatically appear in the CLI output. Verify this by reading the code — no changes expected unless the spread pattern changed.

## Acceptance criteria
- ClassifyRunResult interface includes `durationMs: number | null`
- classifyRun() reads `duration_ms` from the `runs` table row and returns it
- New tests verify: durationMs present when set, null when not set
- classify-run.ts CLI JSON output includes durationMs (via spread)
- All existing tests pass (`bun test minds/observability/`)
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

Do NOT commit your changes. The Mind will handle committing and merging after review passes.

When all tasks are complete and the checklist passes, report: "DRONE_COMPLETE @observability BRE-432"
