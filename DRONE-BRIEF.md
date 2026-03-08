# Drone Brief: @memory for BRE-449

Mind pane ID (for sending completion signal): %34648

## Tasks assigned to you

- [ ] T001 @memory Add `--content-file <path>` flag to `minds/memory/lib/write-cli.ts` — reads content from file instead of `--content` arg (mutually exclusive with `--content`) — produces: write-cli.ts --content-file at minds/memory/lib/write-cli.ts
- [ ] T002 @memory [P] Add tests for `--content-file` flag in `minds/memory/lib/write-cli.test.ts` — verify file read, mutual exclusivity with --content, missing file error
- [ ] T003 @memory [P] Verify existing `minds/memory/lib/hygiene-cli.ts` has test coverage — add `minds/memory/lib/hygiene-cli.test.ts` if missing (promote entries, prune stale, combined promote+prune, error cases)

## Interface contracts

- Produces: `write-cli.ts --content-file` flag at `minds/memory/lib/write-cli.ts`
- Consumes: nothing (no external dependencies)

## Implementation guidance

### T001: --content-file flag for write-cli.ts
- Add `--content-file <path>` flag alongside existing `--content`
- They are mutually exclusive — error if both provided
- Read file content with `readFileSync(path, "utf-8")`
- Error with descriptive message if file does not exist
- Pass the file content to `appendDailyLog()` exactly as the existing `--content` path does

### T002: Tests for --content-file
- Test file: `minds/memory/lib/write-cli.test.ts`
- If this file already exists, add new test cases to it. If not, create it.
- Test cases: (a) --content-file reads and appends correctly, (b) error when both --content and --content-file given, (c) error when --content-file points to missing file, (d) --content-file with multi-line content preserves formatting

### T003: hygiene-cli.ts test coverage
- Check if `minds/memory/lib/hygiene-cli.test.ts` exists
- If missing, create it with tests: (a) --promote adds entry to MEMORY.md, (b) --prune removes stale entries, (c) combined --promote + --prune, (d) error when no --promote or --prune given, (e) error when --mind missing

## Acceptance criteria

- All tasks marked [X] in tasks.md
- All produced interfaces exported at their declared paths
- `bun test` passes with no failures
- No files modified outside your owned paths (`minds/memory/`)

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
bun minds/transport/minds-publish.ts --channel minds-BRE-449 --type DRONE_COMPLETE --payload '{"mindName":"memory"}'
```

The bus URL is resolved automatically from `BUS_URL` env var or `.collab/bus-port`.
