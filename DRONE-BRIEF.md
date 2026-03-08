# Drone Brief: @templates BRE-442

Mind pane ID: %31299

## Problem

17 files referenced by installed `.claude/commands/*.md` are missing from `minds/templates/`. The installer copies `minds/templates/` → `.collab/`, so anything not in templates doesn't get installed.

## Task

Add the 17 missing files to `minds/templates/` so they get installed to target repos.

**Each file must be a 1:1 copy of its source, with only the import path changed:**
- Source uses `../pipeline_core` or `../signals/` (Mind-relative)
- Template must use `../lib/pipeline/` (`.collab/`-relative)

### Missing files to add

**handlers/** (add to `minds/templates/handlers/`):
1. `emit-signal.ts` — source: `minds/signals/emit-signal.ts`
2. `emit-build-signal.ts` — source: `minds/signals/emit-build-signal.ts` (if it doesn't exist as a standalone, check if it's a thin wrapper calling emit-signal.ts — if so, create the same pattern)
3. `emit-verify-signal.ts` — source: `minds/signals/emit-verify-signal.ts` (same — check source)

**scripts/** (add to `minds/templates/scripts/`):
4. `analyze-task-phases.ts` — source: `minds/execution/analyze-task-phases.ts`
5. `resolve-execution-mode.ts` — source: `minds/execution/resolve-execution-mode.ts`
6. `emit-findings.ts` — source: `minds/signals/emit-findings.ts`
7. `deploy-verify-executor.ts` — source: `minds/execution/deploy-verify-executor.ts`
8. `pre-deploy-summary.ts` — source: `minds/execution/pre-deploy-summary.ts`
9. `run-tests-executor.ts` — source: find in `minds/execution/` or `minds/signals/`
10. `verify-execute-executor.ts` — source: find in `minds/execution/`
11. `visual-verify-executor.ts` — source: find in `minds/execution/`

**scripts/orchestrator/commands/** (add to `minds/templates/scripts/orchestrator/commands/`):
12. `resolve-questions.ts` — source: find in `minds/execution/`
13. `teardown-bus.ts` — source: find in `minds/execution/` or `minds/transport/`
14. `write-resolutions.ts` — source: find in `minds/execution/`

**lib/pipeline/** (add to `minds/templates/lib-pipeline/`):
15. `questions.ts` — source: `minds/pipeline_core/questions.ts`

**transport/** (add to `minds/templates/transport/`):
16. `bus-server.ts` — source: `minds/transport/bus-server.ts`

**scripts/orchestrator/** (add to `minds/templates/scripts/orchestrator/`):
17. `evaluate-gate.ts` — source: `minds/execution/evaluate-gate.ts`

## Rules

- **1:1 copy** of source file. Do NOT rewrite, rename variables, or change logic.
- **Only change import paths**: `../pipeline_core` → `../lib/pipeline`, `../signals/` → `../handlers/`, etc.
- If a source file doesn't exist, check if the command that references it is outdated. Note it and skip.
- Create directories as needed (`mkdir -p`).
- Do NOT modify any files outside `minds/templates/`.

## Acceptance criteria

- All 17 files (or noted as non-existent source) present in `minds/templates/`
- Import paths adjusted for `.collab/` installed structure
- No logic changes vs source

## When done

```bash
bun minds/lib/tmux-send.ts %31299 "DRONE_COMPLETE @templates BRE-442"
```
