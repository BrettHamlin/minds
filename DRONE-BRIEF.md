# Drone Brief: @signals for BRE-437

Mind pane ID (for sending completion signal): %29523

## Tasks assigned to you

- [ ] T002 @signals [P] Verify clarify signal constants exist — confirm `minds/signals/emit-question-signal.ts` and `minds/signals/pipeline-signal.ts` cover all needed clarify signals (CLARIFY_QUESTION, CLARIFY_COMPLETE); add any missing signal names — produces: clarify signal constants at minds/signals/pipeline-signal.ts

## Interface contracts

- Produces: clarify signal constants at minds/signals/pipeline-signal.ts
- Consumes: pipeline_core/loadPipelineForTicket (existing — already available), pipeline_core/signal (existing), transport/resolveTransportPath (existing)

## Acceptance criteria

- All tasks marked [X] in tasks.md
- All produced interfaces exported at their declared paths
- `bun test` passes with no failures
- No files modified outside your owned paths (minds/signals/)

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks marked [X]
- [ ] No files modified outside owns_files (minds/signals/)
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
bun minds/lib/tmux-send.ts %29523 "DRONE_COMPLETE @signals BRE-437"
```

This sends the signal directly to the Mind's pane. Do NOT just type the signal — you must run this command.
