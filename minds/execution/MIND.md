# @execution Mind Profile

## Domain

Pipeline runtime: phase dispatch, gate evaluation, signal validation, orchestrator initialization, phase hooks, retry config, and execution mode resolution. This Mind drives the active lifecycle of a pipeline run.

## Conventions

- **Signal names come from `resolveSignalName()`** in `pipeline_core/signal.ts` — never construct `PHASE_COMPLETE` or similar names via string concatenation.
- **All paths come from `paths.ts`** (`registryPath`, `findingsPath`, `resolutionsPath`, `signalQueuePath`) — never construct `.collab/state/` paths inline.
- **Pipeline config loaded via `loadPipelineForTicket(repoRoot, ticketId)`** — never read pipeline.json directly or hardcode variant paths.
- Gate prompts are resolved by `evaluate-gate.ts` — the LLM gets the prompt text, not raw file paths.
- Execution mode (`interactive` vs `autonomous`) resolved by `resolve-execution-mode.ts` — never check env vars inline.
- Retry counts are derived from `phase_history` in the registry, not from a counter field — use `resolveRetryConfig`.
- Pre/post phase hooks are dispatched by `dispatch-phase-hooks.ts` — phase-dispatch.ts imports from it (single source of truth).

## Key Files

- `minds/execution/phase-dispatch.ts` — main dispatcher: reads registry, evaluates gate, advances phase
- `minds/execution/evaluate-gate.ts` — resolves gate prompts + validates verdicts
- `minds/execution/signal-validate.ts` — validates incoming signal against pipeline config
- `minds/execution/orchestrator-init.ts` — sets up worktree paths for a new pipeline run
- `minds/execution/dispatch-phase-hooks.ts` — pre/post hook list (imported by phase-dispatch.ts)
- `minds/execution/resolve-retry-config.ts` — phase_history-based attempt counting

## Anti-Patterns

- Hardcoding phase names like `"clarify"`, `"implement"` as string literals (use pipeline config).
- Constructing `.collab/state/pipeline-registry/` paths without `registryPath()`.
- Reading pipeline.json with a hardcoded path (always use `loadPipelineForTicket`).
- Calling `dispatch-phase-hooks.ts` logic inline instead of importing from it.
- Using environment variables to detect execution mode (use `resolve-execution-mode.ts`).

## Review Focus

- No inline path construction — every `.collab/` path uses an imported utility.
- Signal names resolved via `resolveSignalName()`, never as raw strings.
- Phase hooks dispatched through `dispatch-phase-hooks.ts` (not duplicated in callers).
- Gate evaluation is deterministic: prompt resolution in code, verdict judgment by LLM.
