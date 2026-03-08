# Drone Brief: @cli for BRE-433

Mind pane ID (for sending completion signal): %28679

## Tasks assigned to you

- [ ] T008 @cli Add `doctor` subcommand handler in `minds/cli/commands/doctor.ts` that imports and calls `runDoctorChecks()` — consumes: `runDoctorChecks()` from `minds/installer/core.ts`
- [ ] T009 @cli Add `doctor` subcommand to compiled binary entry point at `minds/cli/index.ts` — route `collab doctor` to the handler in `minds/cli/commands/doctor.ts`
- [ ] T010 @cli Add `doctor` subcommand to commander-based entry point at `minds/cli/bin/collab.ts` — route `collab doctor` to the same handler
- [ ] T011 @cli Add `--json` flag support to doctor command output in `minds/cli/commands/doctor.ts` — human-readable table by default, JSON when `--json` passed
- [ ] T012 @cli Add tests for doctor CLI subcommand in `minds/cli/commands/doctor.test.ts` covering: output formatting for passing and failing checks, `--json` flag, `--help` flag

## Interface contracts

- Consumes:
  - `runDoctorChecks(repoRoot: string): DoctorResult` from `minds/installer/core.ts`
  - `DoctorCheck` type from `minds/installer/core.ts`
  - `DoctorResult` type from `minds/installer/core.ts`
- Produces:
  - `doctor` subcommand available via `collab doctor`
  - `doctorCommand()` handler function at `minds/cli/commands/doctor.ts`

## Important: Both CLI entry points

Per MIND.md conventions, new subcommands MUST be added to BOTH entry points:
1. `minds/cli/index.ts` — compiled binary (manual arg parsing)
2. `minds/cli/bin/collab.ts` — npm package (commander-based)

## Acceptance criteria

- All tasks marked [X] in tasks.md
- `collab doctor` works from both entry points
- Human-readable output by default, JSON with `--json`
- `bun test` passes with no failures
- No files modified outside your owned paths (`minds/cli/`)

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks marked [X]
- [ ] No files modified outside owns_files (`minds/cli/`)
- [ ] No duplicated logic (check against existing codebase)
- [ ] All new functions have tests
- [ ] All tests pass (`bun test`)
- [ ] No lint errors
- [ ] Interface contracts honored (import from `minds/installer/core.ts`, do NOT reimplement)
- [ ] No hardcoded values that should be config
- [ ] Error messages include context (not just "failed")
- [ ] Both entry points updated (index.ts AND bin/collab.ts)

Do NOT commit your changes. The Mind will handle committing and merging after review passes.

When all tasks are complete and the checklist passes, send completion signal to the Mind:

```bash
bun minds/lib/tmux-send.ts %28679 "DRONE_COMPLETE @cli BRE-433"
```

This sends the signal directly to the Mind's pane. Do NOT just type the signal — you must run this command.
