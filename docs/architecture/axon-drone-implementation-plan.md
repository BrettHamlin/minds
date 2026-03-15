# Axon Drone Replacement — Implementation Plan

**Status:** Approved (Architect + Engineer)
**Date:** 2026-03-13
**Architecture:** [axon-drone-replacement.md](axon-drone-replacement.md)

---

## Engineer Required Changes (Incorporated)

1. **BLOCKER**: Add `cwd` parameter to Axon's Spawn protocol — Rust daemon + TS client
2. Add process cleanup after `kill()` in AxonDroneBackend (prevent dead process accumulation)
3. Add orphan cleanup mechanism on Axon daemon startup (PID file tracking)
4. Drop `MINDS_MULTIPLEXER` fallback from drone factory (use only `MINDS_DRONE_BACKEND`)
5. Acknowledge test mock scope: 6-8 files need DroneHandle migration

---

## Phase A: Axon Protocol Extension (Axon repo — BLOCKER)

Must complete before any Gravitas changes.

### Task A1: Add `cwd` to Spawn protocol message (Rust) — [BRE-627](https://linear.app/bretthamlin/issue/BRE-627)
- **Files:** `axon-core/src/protocol/messages.rs`, `axon-core/src/process/manager.rs`
- **What:** Add optional `cwd: Option<String>` to `SpawnRequest`. Process manager calls `Command::current_dir(cwd)` when present.
- **Tests:** Rust integration test spawning a process with `cwd` set, verify working directory.

### Task A2: Add `cwd` to TS client spawn() — [BRE-628](https://linear.app/bretthamlin/issue/BRE-628)
- **Files:** `minds/lib/axon/client.ts`
- **What:** Add optional `cwd?: string` parameter to `spawn()`. Include in protocol message when present.
- **Tests:** Update existing client tests to cover `cwd` parameter.

### Task A3: Orphan cleanup on daemon startup — [BRE-629](https://linear.app/bretthamlin/issue/BRE-629)
- **Files:** `axon-core/src/process/manager.rs`, `axon-core/src/daemon/mod.rs`
- **What:** On daemon startup, scan for orphaned child processes from previous daemon instance. Track managed PIDs in a state file. On startup, check if stale PIDs are still running and kill them.
- **Tests:** Integration test: start daemon, spawn process, kill daemon, restart daemon, verify stale process cleaned up.

---

## Phase B: DroneBackend Abstraction (Gravitas repo)

### Task B1: Create DroneBackend interface + types — [BRE-630](https://linear.app/bretthamlin/issue/BRE-630)
- **Files (new):** `minds/lib/drone-backend.ts`
- **What:** `DroneBackend` interface, `DroneHandle` type, `DroneSpawnOpts` type. See architecture doc Section 2.

### Task B2: Create TmuxDroneBackend — [BRE-631](https://linear.app/bretthamlin/issue/BRE-631)
- **Files (new):** `minds/lib/tmux/drone-backend-tmux.ts`
- **What:** Implements DroneBackend using existing TmuxMultiplexer. Wraps splitPane + sendKeys + sentinel file.
- **Tests:** Unit tests with mocked TmuxMultiplexer.

### Task B3: Create AxonDroneBackend — [BRE-632](https://linear.app/bretthamlin/issue/BRE-632)
- **Files (new):** `minds/lib/axon/drone-backend-axon.ts`
- **What:** Implements DroneBackend using AxonClient.spawn() with `cwd`. Uses event-based completion. Includes process cleanup after kill (engineer change #2).
- **Tests:** Unit tests with mocked AxonClient.

### Task B4: Create DroneBackend factory — [BRE-633](https://linear.app/bretthamlin/issue/BRE-633)
- **Files (new):** `minds/lib/drone-backend-factory.ts`
- **What:** `createDroneBackend(repoRoot, forceBackend?)`. Reads `MINDS_DRONE_BACKEND` env var only (no `MINDS_MULTIPLEXER` fallback per engineer feedback). Auto-detection when unset.
- **Tests:** Unit tests for env var parsing, auto-detection, fallback.

---

## Phase C: Wire Into drone-pane.ts (Gravitas repo)

### Task C1: Replace TmuxMultiplexer with DroneBackend in drone-pane.ts — [BRE-634](https://linear.app/bretthamlin/issue/BRE-634)
- **Files:** `minds/lib/drone-pane.ts`
- **What:** Lines ~375-398: Replace `new TmuxMultiplexer()` + `splitPane` + `sendKeys` with `createDroneBackend()` + `backend.spawn()`. Add `--backend` CLI flag. Output JSON includes `backend` field.
- **Tests:** E2E test with both backends.

---

## Phase D: Wire Into Supervisor (Gravitas repo)

### Task D1: Update supervisor types (DroneHandle migration) — [BRE-635](https://linear.app/bretthamlin/issue/BRE-635)
- **Files:** `minds/lib/supervisor/supervisor-types.ts`, `minds/lib/supervisor/pipeline-types.ts`
- **What:** `paneId: string` → `DroneHandle` throughout. `dronePane` → `droneHandle`. `allSpawnedPanes` → `allSpawnedHandles`. Add `mockHandle()` helper for tests.

### Task D2: Update spawn-drone stage — [BRE-636](https://linear.app/bretthamlin/issue/BRE-636)
- **Files:** `minds/lib/supervisor/stages/spawn-drone.ts`
- **What:** Use DroneBackend for spawning. Conditional trust dialog handling (`if handle.backend === "tmux"`). Set `ctx.droneHandle`.

### Task D3: Update wait-completion stage — [BRE-637](https://linear.app/bretthamlin/issue/BRE-637)
- **Files:** `minds/lib/supervisor/stages/wait-completion.ts`
- **What:** Pass DroneHandle to `waitForDroneCompletion`. Axon path uses event-based detection. Tmux path uses sentinel + poll.

### Task D4: Update supervisor-drone.ts — [BRE-638](https://linear.app/bretthamlin/issue/BRE-638)
- **Files:** `minds/lib/supervisor/supervisor-drone.ts`
- **What:** `waitForDroneCompletion` accepts DroneHandle, routes to Axon or tmux path. `relaunchDroneInWorktree` uses DroneBackend. Conditional sentinel hook installation.

### Task D5: Update test mocks (6-8 files) — [BRE-639](https://linear.app/bretthamlin/issue/BRE-639)
- **Files:** All supervisor test files using `paneId`
- **What:** Wrap string IDs with `mockHandle()`. Mechanical change.

---

## Phase E: Default Flip + E2E Validation

### Task E1: Default to Axon when available — [BRE-640](https://linear.app/bretthamlin/issue/BRE-640)
- **Files:** `minds/lib/drone-backend-factory.ts`
- **What:** Auto-detection prefers Axon. `MINDS_DRONE_BACKEND=tmux` is instant rollback.

### Task E2: Full E2E validation — [BRE-641](https://linear.app/bretthamlin/issue/BRE-641)
- **What:** Full supervisor cycle with both backends. Clone test project → minds init → fission → task → implement. Both `MINDS_DRONE_BACKEND=axon` and `MINDS_DRONE_BACKEND=tmux`.

---

## Phase F: Cleanup (Deferred)

### Task F1: Remove sentinel file mechanism
- **What:** Once tmux fallback is no longer needed, remove sentinel touch command from Stop hook. Keep bus event hooks.

---

## Dependency Graph

```
BRE-627 → BRE-628 ──→ BRE-632 ──→ BRE-633 ──→ BRE-634 ──→ BRE-635 → BRE-636 → BRE-637 → BRE-638 → BRE-639 ──→ BRE-640 → BRE-641
BRE-629 ──┘             BRE-630 ──→ BRE-631 ──┘
```

- BRE-627+629 can run in parallel (Rust daemon changes)
- BRE-630+631 can run in parallel with Phase A (no dependencies)
- BRE-632 needs BRE-628 (cwd support in client)
- BRE-633 needs BRE-631+632 (both backends)
- BRE-634 needs BRE-633 (factory)
- BRE-635→639 are sequential (supervisor migration)
- BRE-640 needs BRE-639 (all tests passing)
- BRE-641 needs BRE-640 (default flip)

## Estimated Scope

| Phase | Tasks | Size |
|-------|-------|------|
| A | 3 | M (Rust + TS protocol changes) |
| B | 4 | M (new files, well-defined interfaces) |
| C | 1 | S (focused change in drone-pane.ts) |
| D | 5 | L (most files touched, test migration) |
| E | 2 | M (default flip + full E2E) |
| F | 1 | S (deferred cleanup) |
| **Total** | **16 tasks** | |
