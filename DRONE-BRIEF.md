# Drone Brief: @installer for BRE-433

Mind pane ID (for sending completion signal): %28679

## Tasks assigned to you

- [ ] T001 @installer [P] Add `DoctorCheck` and `DoctorResult` types to `minds/installer/core.ts` — produces: `DoctorCheck` type at `minds/installer/core.ts`
- [ ] T002 @installer [P] Add `DoctorResult` type to `minds/installer/core.ts` — produces: `DoctorResult` type at `minds/installer/core.ts`
- [ ] T003 @installer Add `checkFilePresence()` function to `minds/installer/core.ts` that verifies all expected installed files exist (dirs list + template copy targets) — produces: `checkFilePresence()` at `minds/installer/core.ts`
- [ ] T004 @installer Add `checkScriptPermissions()` function to `minds/installer/core.ts` that verifies installed scripts and handlers are executable (mode 0o755) using the dirs list from `installTemplates` — produces: `checkScriptPermissions()` at `minds/installer/core.ts`
- [ ] T005 @installer Add `checkConfigSchema()` function to `minds/installer/core.ts` that validates installed pipeline config is parseable JSON with required fields — produces: `checkConfigSchema()` at `minds/installer/core.ts`
- [ ] T006 @installer Add `runDoctorChecks(repoRoot: string): DoctorResult` function to `minds/installer/core.ts` that orchestrates T003-T005 checks and returns aggregated results — produces: `runDoctorChecks()` at `minds/installer/core.ts`
- [ ] T007 @installer Add tests for `runDoctorChecks()` in `minds/installer/core.test.ts` covering: all-pass, missing files, bad permissions, invalid config JSON

## Interface contracts

- Produces:
  - `DoctorCheck` type exported from `minds/installer/core.ts`
  - `DoctorResult` type exported from `minds/installer/core.ts`
  - `runDoctorChecks(repoRoot: string): DoctorResult` exported from `minds/installer/core.ts`
- Consumes: nothing new (existing `ensureDir` from `../cli/utils/fs` already imported)

## Acceptance criteria

- All tasks marked [X] in tasks.md
- All produced interfaces exported at their declared paths
- `bun test` passes with no failures
- No files modified outside your owned paths (`minds/installer/`)

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks marked [X]
- [ ] No files modified outside owns_files (`minds/installer/`)
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
bun minds/lib/tmux-send.ts %28679 "DRONE_COMPLETE @installer BRE-433"
```

This sends the signal directly to the Mind's pane. Do NOT just type the signal — you must run this command.
