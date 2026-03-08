# Drone Brief: @clarify for BRE-437

Mind pane ID (for sending completion signal): %29523

## Tasks assigned to you

- [ ] T003 @clarify Create Clarify Mind server — create `minds/clarify/server.ts` following the `createMind()` pattern from `minds/signals/server.ts`. Domain: pipeline clarify stage Q&A protocol, findings emission, resolution handling. `owns_files` must include both `minds/clarify/` and `src/commands/collab.clarify.md`. Capabilities: run clarify phase, group batch questions, apply resolutions. Consumes existing exports: `pipeline_core/findingsPath`, `pipeline_core/resolutionsPath`, `pipeline_core/loadPipelineForTicket`, `signals/emit-question-signal` — consumes: clarify phase types from minds/pipeline_core/types.ts, clarify signal constants from minds/signals/pipeline-signal.ts
- [ ] T004 @clarify Create MIND.md domain profile — create `minds/clarify/MIND.md` documenting the clarify stage domain knowledge: Q&A protocol, findings/resolutions flow, interactive vs batch modes, key files (`src/commands/collab.clarify.md`, `minds/pipeline_core/questions.ts`), review focus (schema compliance, round numbering, signal emission), anti-patterns (inline path construction, hardcoded signal names)
- [ ] T005 @clarify Register Clarify Mind in generate-registry — update `minds/generate-registry.ts` discovery so it finds `minds/clarify/server.ts` (should happen automatically via `findChildServerFiles` if following the `server.ts` convention; verify 12→13 Minds in output)
- [ ] T006 @clarify Add clarify-specific batch question grouping utility — create `minds/clarify/group-questions.ts` with logic to group related findings by topic/section before emission (if not already implemented in `questions.ts`). Export `groupFindings(findings: Finding[]): GroupedFindings[]` — produces: groupFindings() at minds/clarify/group-questions.ts
- [ ] T007 @clarify Write tests for Clarify Mind — create `minds/clarify/server.test.ts` testing: describe() returns correct MindDescription with `owns_files` including `src/commands/collab.clarify.md`; handle() routes "run clarify phase" intent; handle() returns escalate for unknown intents. Create `minds/clarify/group-questions.test.ts` testing grouping logic

## Interface contracts

- Produces: groupFindings() at minds/clarify/group-questions.ts
- Consumes:
  - clarify phase types from minds/pipeline_core/types.ts (already merged from Wave 1)
  - clarify signal constants from minds/signals/pipeline-signal.ts (already merged from Wave 1)
  - findingsPath() from minds/pipeline_core/paths.ts (existing)
  - resolutionsPath() from minds/pipeline_core/paths.ts (existing)
  - loadPipelineForTicket() from minds/pipeline_core/pipeline.ts (existing)

## Key references (read these to understand the domain)

- `minds/signals/server.ts` — follow this pattern for createMind()
- `minds/pipeline_core/questions.ts` — shared Q&A protocol (Finding, FindingsBatch types)
- `src/commands/collab.clarify.md` — the pipeline clarify command (you own this file)
- `minds/signals/emit-question-signal.ts` — clarify signal emission
- `minds/signals/emit-findings.ts` — findings batch emission

## Acceptance criteria

- All tasks marked [X]
- `minds/clarify/server.ts` exists with `owns_files` including `src/commands/collab.clarify.md`
- `minds/clarify/MIND.md` documents the clarify domain
- `bun minds/generate-registry.ts` outputs 13 Minds (was 12)
- `bun test` passes with no new failures
- No files modified outside your owned paths (minds/clarify/)

## Review checklist (verify before reporting DRONE_COMPLETE)

- [ ] All tasks complete
- [ ] No files modified outside owns_files (minds/clarify/)
- [ ] No duplicated logic (check against existing codebase)
- [ ] All new functions have tests
- [ ] All tests pass (`bun test`)
- [ ] No lint errors
- [ ] Interface contracts honored (produces/consumes match declarations)
- [ ] No hardcoded values that should be config
- [ ] Error messages include context (not just "failed")
- [ ] `import type` for type-only imports

Do NOT commit your changes. The Mind will handle committing and merging after review passes.

When all tasks are complete and the checklist passes, send completion signal to the Mind:

```bash
bun minds/lib/tmux-send.ts %29523 "DRONE_COMPLETE @clarify BRE-437"
```

This sends the signal directly to the Mind's pane. Do NOT just type the signal — you must run this command.
