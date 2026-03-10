---
name: Work Order
role: Ephemeral task assignment — tasks, dependencies, metadata
scope: Changes per run — this is your current assignment
---

# Work Order: @memory

| Field | Value |
|-------|-------|
| **Ticket** | BRE-TEST-FB3 |
| **Wave** | wave-1 |

---

## Drone Tasks

- [ ] T1 Refactor `searchMemory()` in `minds/memory/lib/search.ts` to support a new `scope: "cross-mind"` option that searches across ALL Minds' memory directories (not just one). The function should aggregate results from all Mind directories found under `minds/*/memory/`, merge them using the existing `mergeHybridResults()`, and include a `mindName` field in each `SearchResult` so callers know which Mind the result came from.
- [ ] T2 Update the `SearchResult` interface to add the optional `mindName?: string` field. This must be backwards-compatible — existing callers that don't use cross-mind search should not break.
- [ ] T3 Update `search-cli.ts` to accept a `--scope cross-mind` flag. When used, `--mind` becomes optional (ignored for cross-mind scope).
- [ ] T4 Write tests for cross-mind search in a new file `minds/memory/lib/search-cross-mind.test.ts`. Test: multi-mind aggregation, result deduplication, mindName field populated, and fallback when no minds exist.
- [ ] T5 The `SearchResult.mindName` field MUST use the Mind's display name from `.minds/minds.json` (the `name` field), not the directory name. If a directory has no matching entry in minds.json, use the directory name as fallback.

## Important Constraints

- All path construction must go through `paths.ts`
- Do NOT modify existing test files — only create new ones
- The cross-mind search must work even when some Mind memory dirs have no index yet (graceful degradation)
- SearchResult interface changes must preserve backwards compatibility
