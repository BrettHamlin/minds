# @pipeline_core Mind Profile

## Domain

The foundation layer: pipeline types, registry CRUD, signal definitions, phase transitions, path construction, repo-registry, feature directory resolution, and JSON I/O. Every other Mind depends on this one — it has no `consumes` dependencies.

## Conventions

- **All `.gravitas/` path construction goes through `paths.ts`**: `registryPath()`, `findingsPath()`, `resolutionsPath()`, `signalQueuePath()`. Never construct these paths inline in any file.
- `getRegistryPath()` is removed — all callers use `registryPath()` from `paths.ts`.
- `loadPipelineForTicket(repoRoot, ticketId)` in `pipeline.ts` is the single function for loading pipeline config. Never read `pipeline.json` directly.
- Signal names use `SIGNAL_SUFFIXES` constants and `resolveSignalName()` from `signal.ts` — never construct `PHASE_COMPLETE` style names as raw strings.
- Feature directory lookup uses `findFeatureDir()` with its 4-pass search (exact branch → prefix → ticketId name → metadata.json). Do not implement your own feature search.
- `validateTicketIdArg(args, scriptName)` is the single place for ticket ID validation in CLI scripts.

## Key Files

- `minds/pipeline_core/paths.ts` — `registryPath`, `findingsPath`, `resolutionsPath`, `signalQueuePath`
- `minds/pipeline_core/signal.ts` — `SIGNAL_SUFFIXES`, `resolveSignalName()`, `getAllowedSignals()`
- `minds/pipeline_core/transitions.ts` — `resolveTransition()` for signal → next phase mapping
- `minds/pipeline_core/pipeline.ts` — `loadPipelineForTicket()`, `resolvePipelineConfigPath()`
- `minds/pipeline_core/feature.ts` — `findFeatureDir()`, `readFeatureMetadata()`, `readMetadataJson()`
- `minds/pipeline_core/types.ts` — `CompiledPipeline`, `PipelinePhase`, `RegistryEntry` and all core types
- `minds/pipeline_core/task-phases.ts` — `parseTaskPhases()` (shared with execution Mind)

## Anti-Patterns

- Constructing `.gravitas/state/pipeline-registry/{TICKET_ID}.json` inline (always use `registryPath()`).
- Calling `getRegistryPath()` — it is removed, use `registryPath()`.
- Reading `pipeline.json` at a hardcoded path (use `loadPipelineForTicket`).
- Adding new path helpers in a non-`paths.ts` file.
- Duplicating the `CompiledPipeline` type definition (it lives only in `types.ts`).

## Review Focus

- Zero inline `.gravitas/` path construction across all files in this Mind.
- All signal name resolution goes through `signal.ts` exports.
- `findFeatureDir()` used for all feature directory lookups (no custom glob patterns).
- New types exported from `types.ts`, not scattered across modules.
