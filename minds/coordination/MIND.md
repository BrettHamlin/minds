# @coordination Mind Profile

## Domain

Multi-ticket coordination: dependency hold detection, group management, batch Q&A resolution, held-release scanning, and ticket dependency graph analysis. Prevents tickets from proceeding when their dependencies haven't completed.

## Conventions

- **Push-based Q&A** — agents emit a question signal and end their response. The orchestrator writes resolutions; agents detect them on re-entry. Never poll for answers in a loop.
- Resolution files are read via `pipeline_core/resolutionsPath` — never construct `.collab/state/` paths inline.
- Registry reads go through `pipeline_core/readJsonFile` — do not use `fs.readFileSync` directly for registry files.
- Dependency cycles are detected by `coordination-check.ts` via `buildAdjacency` + `detectCycles` — never reimplement graph traversal.
- Group IDs are UUIDs generated at creation time and stored in the groups directory.

## Key Files

- `minds/coordination/coordination-check.ts` — adjacency graph + cycle detection
- `minds/coordination/check-dependency-hold.ts` — registry hold check for a single ticket
- `minds/coordination/held-release-scan.ts` — scans all held tickets and releases unblocked ones
- `minds/coordination/write-resolutions.ts` — writes resolution JSON for Q&A answers
- `minds/coordination/resolve-questions.ts` — reads and applies resolutions to agent state
- `minds/coordination/group-manage.ts` — group CRUD operations

## Anti-Patterns

- Polling for Q&A resolutions (push-based protocol only — agent re-entry handles detection).
- Writing to the registry directly instead of via pipeline_core path utilities.
- Reimplementing path construction for `.collab/state/resolutions/` or `.collab/state/registry/`.
- Treating a dependency hold as an error — it is a normal "wait" state, not a failure.

## Review Focus

- Q&A flows are push-based: signal emitted → response ends → re-entry detects resolution.
- All path construction uses imported utilities from `pipeline_core`.
- Cycle detection covers transitive dependencies (not just direct).
