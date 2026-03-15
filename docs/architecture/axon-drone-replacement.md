# Architecture: Axon Replaces tmux for Drone Management

**Status:** Draft
**Author:** Architect Agent
**Date:** 2026-03-13

---

## 1. High-Level Design Decision

**Approach: Direct Axon spawn, bypass the TerminalMultiplexer abstraction for drones.**

The TerminalMultiplexer interface (`splitPane` + `sendKeys`) was designed for the tmux interaction model (create a shell, then type a command into it). Axon's model is fundamentally different: `spawn()` creates a process directly with a command. Forcing drone spawning through the multiplexer abstraction adds unnecessary indirection and semantic mismatch.

Instead, drone-pane.ts and supervisor-drone.ts will use AxonClient directly when Axon is available, falling back to TmuxMultiplexer when it is not. The multiplexer factory continues to serve non-drone use cases (monitoring panes, ad-hoc commands).

**Key insight:** The AxonMultiplexer's `splitPane` allocates a logical ID without spawning anything, then `sendKeys` spawns via `/bin/sh -c`. For drones, we want a single atomic operation: spawn Claude Code as a managed Axon process with a predictable process ID. This gives us instant exit detection, output capture, and clean kill semantics without the two-step dance.

---

## 2. Core Abstraction: DroneBackend

A new interface sits between the supervisor and the spawn mechanism, encapsulating the "how" of drone lifecycle management.

```typescript
// minds/lib/drone-backend.ts

export interface DroneHandle {
  /** Identifier for this drone (tmux pane ID or Axon process ID). */
  id: string;
  /** Which backend manages this drone. */
  backend: "axon" | "tmux";
}

export interface DroneBackend {
  /** Spawn Claude Code in a worktree. Returns a handle for tracking. */
  spawn(opts: DroneSpawnOpts): Promise<DroneHandle>;

  /** Kill a running drone. Idempotent (no-op if already dead). */
  kill(handle: DroneHandle): Promise<void>;

  /** Wait for a drone to finish. Returns completion status. */
  waitForCompletion(
    handle: DroneHandle,
    worktreePath: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; exitCode?: number; error?: string }>;

  /** Check if a drone is still running. */
  isAlive(handle: DroneHandle): Promise<boolean>;

  /** Capture drone output (for diagnostics/logging). */
  captureOutput(handle: DroneHandle): Promise<string>;

  /** Release resources (close sockets, etc). */
  close(): void;
}

export interface DroneSpawnOpts {
  /** Unique identifier for this drone process. */
  processId: string;
  /** Working directory (the worktree path). */
  cwd: string;
  /** The Claude Code command + arguments. */
  command: string;
  args: string[];
  /** Environment variables to inject (BUS_URL, etc). */
  env?: Record<string, string>;
  /** For tmux backend: the pane to split from. */
  callerPane?: string;
}
```

### 2.1 AxonDroneBackend

```typescript
// minds/lib/axon/drone-backend-axon.ts

export class AxonDroneBackend implements DroneBackend {
  constructor(private client: AxonClient) {}

  async spawn(opts: DroneSpawnOpts): Promise<DroneHandle> {
    // Build the full command: cd to worktree, then exec claude
    // Axon spawns directly -- no PTY, no shell wrapper needed
    const processId = sanitizeProcessId(opts.processId);

    // Spawn via Axon with env vars
    await this.client.spawn(
      processId,
      opts.command,
      opts.args,
      opts.env ?? null,
    );

    return { id: processId, backend: "axon" };
  }

  async kill(handle: DroneHandle): Promise<void> {
    try {
      await this.client.kill(handle.id);
    } catch {
      // Already dead -- idempotent
    }
  }

  async waitForCompletion(
    handle: DroneHandle,
    _worktreePath: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; exitCode?: number; error?: string }> {
    // Use the existing event-based completion detection
    return waitForProcessCompletion(this.client, handle.id, timeoutMs);
  }

  async isAlive(handle: DroneHandle): Promise<boolean> {
    try {
      const info = await this.client.info(handle.id);
      return info.state === "Running" || info.state === "Starting";
    } catch {
      return false;
    }
  }

  async captureOutput(handle: DroneHandle): Promise<string> {
    const result = await this.client.readBuffer(handle.id);
    return result.data;
  }

  close(): void {
    this.client.close();
  }
}
```

### 2.2 TmuxDroneBackend

```typescript
// minds/lib/tmux/drone-backend-tmux.ts

export class TmuxDroneBackend implements DroneBackend {
  private mux = new TmuxMultiplexer();

  async spawn(opts: DroneSpawnOpts): Promise<DroneHandle> {
    const paneId = await this.mux.splitPane(opts.callerPane!);

    // Build full command string for sendKeys
    let cmd = `cd ${shellQuote(opts.cwd)} && ${opts.command} ${opts.args.map(a => JSON.stringify(a)).join(" ")}`;
    if (opts.env) {
      const envPrefix = Object.entries(opts.env)
        .map(([k, v]) => `${k}=${shellQuote(v)}`)
        .join(" ");
      cmd = `${envPrefix} ${cmd}`;
    }
    await this.mux.sendKeys(paneId, cmd);

    return { id: paneId, backend: "tmux" };
  }

  async kill(handle: DroneHandle): Promise<void> {
    await this.mux.killPane(handle.id);
  }

  async waitForCompletion(
    handle: DroneHandle,
    worktreePath: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; exitCode?: number; error?: string }> {
    // Delegate to existing sentinel + poll mechanism
    return waitForDroneCompletion(handle.id, worktreePath, timeoutMs);
  }

  async isAlive(handle: DroneHandle): Promise<boolean> {
    return this.mux.isPaneAlive(handle.id);
  }

  async captureOutput(handle: DroneHandle): Promise<string> {
    return this.mux.capturePane(handle.id);
  }

  close(): void {
    this.mux.close?.();
  }
}
```

### 2.3 DroneBackend Factory

```typescript
// minds/lib/drone-backend-factory.ts

export async function createDroneBackend(
  repoRoot: string,
  forceBackend?: "axon" | "tmux",
): Promise<DroneBackend> {
  const desired = forceBackend
    ?? process.env.MINDS_DRONE_BACKEND?.toLowerCase()
    ?? process.env.MINDS_MULTIPLEXER?.toLowerCase()
    ?? "auto";

  if (desired === "tmux") {
    return new TmuxDroneBackend();
  }

  if (desired === "axon" || desired === "auto") {
    try {
      const binary = resolveAxonBinary(repoRoot);
      if (!binary) throw new Error("no binary");

      const status = await startAxonDaemon(repoRoot);
      const client = await AxonClient.connect(status.socketPath, {
        maxReconnectAttempts: 3,
        reconnectDelayMs: 500,
      });

      return new AxonDroneBackend(client);
    } catch (err) {
      if (desired === "axon") {
        console.warn(`[drone-backend] MINDS_DRONE_BACKEND=axon but Axon unavailable: ${err}`);
      }
      return new TmuxDroneBackend();
    }
  }

  console.warn(`[drone-backend] Unknown backend "${desired}" -- falling back to tmux`);
  return new TmuxDroneBackend();
}
```

---

## 3. Component Changes (File by File)

### 3.1 New Files

| File | Purpose |
|------|---------|
| `minds/lib/drone-backend.ts` | DroneBackend interface + DroneHandle type |
| `minds/lib/axon/drone-backend-axon.ts` | Axon implementation of DroneBackend |
| `minds/lib/tmux/drone-backend-tmux.ts` | Tmux implementation of DroneBackend |
| `minds/lib/drone-backend-factory.ts` | Factory with auto-detection + env override |

### 3.2 Modified Files

#### `minds/lib/drone-pane.ts`

**What changes:** The CLI entry point gains a `--backend` flag. When backend is `axon`, it skips `mux.splitPane()` + `mux.sendKeys()` and instead uses AxonClient.spawn() directly. The preparation logic (worktree creation, CLAUDE.md assembly, brief writing, hook installation, git exclude) is **unchanged**.

```
Lines ~375-398 change from:

  const mux = new TmuxMultiplexer();
  dronePane = await mux.splitPane(callerPane);
  await mux.sendKeys(dronePane, launchCmd);

To:

  const backend = await createDroneBackend(repoRoot);
  const handle = await backend.spawn({
    processId: `drone-${mindName}-${ticketId}`,
    cwd: worktreePath,
    command: "claude",
    args: ["--dangerously-skip-permissions", "--model", "sonnet",
           "--setting-sources", "project,local", initialPrompt],
    env: busUrl ? { BUS_URL: busUrl } : undefined,
    callerPane,
  });
  dronePane = handle.id;
```

The JSON output gains a `backend` field so callers know which path was taken.

#### `minds/lib/supervisor/supervisor-drone.ts`

**waitForDroneCompletion:**
- Currently hardcodes TmuxMultiplexer for pane-alive checks
- Gains a `backend` parameter (or reads it from DroneHandle)
- When backend is "axon": uses `waitForProcessCompletion()` from completion.ts (event-based, instant)
- When backend is "tmux": uses existing sentinel + poll mechanism (unchanged)
- The sentinel file mechanism is KEPT as the tmux fallback path. It is NOT installed for Axon drones (Axon has reliable exit detection).

**relaunchDroneInWorktree:**
- Currently calls `killPane()`, `splitPane()`, `launchClaudeInPane()`
- Changed to accept a `DroneBackend` instance
- Calls `backend.kill(oldHandle)`, then `backend.spawn(newOpts)` with the same worktree
- Returns a new DroneHandle

**installDroneStopHook:**
- Still called for tmux-backend drones (sentinel file is their completion signal)
- Skipped for Axon-backend drones (Axon provides exit events natively)

#### `minds/lib/supervisor/supervisor-types.ts`

**SupervisorDeps interface changes:**

```typescript
// Current:
spawnDrone: (...) => Promise<{ paneId: string; worktree: string; branch: string }>;
relaunchDroneInWorktree: (...) => Promise<string>;
waitForDroneCompletion: (paneId, worktreePath, timeoutMs) => Promise<{...}>;
killPane: (paneId: string) => Promise<void>;
installDroneStopHook: (worktreePath: string) => void;

// New:
spawnDrone: (...) => Promise<{ handle: DroneHandle; worktree: string; branch: string }>;
relaunchDroneInWorktree: (...) => Promise<DroneHandle>;
waitForDroneCompletion: (handle: DroneHandle, worktreePath, timeoutMs) => Promise<{...}>;
killDrone: (handle: DroneHandle) => Promise<void>;
installDroneStopHook: (worktreePath: string, backend: "axon" | "tmux") => void;
```

The `paneId: string` parameter becomes `handle: DroneHandle` throughout. The handle carries both the ID and which backend manages it, so the supervisor never needs to know the implementation details.

#### `minds/lib/supervisor/stages/spawn-drone.ts`

- `ctx.dronePane` becomes `ctx.droneHandle: DroneHandle`
- `ctx.allSpawnedPanes` becomes `ctx.allSpawnedHandles: DroneHandle[]`
- The `setTimeout` for auto-accepting workspace trust dialog:
  - Still needed for tmux (sends empty Enter keystroke)
  - Not needed for Axon (Claude Code runs headless, no trust dialog)
  - Conditional: `if (handle.backend === "tmux") { ... }`

#### `minds/lib/supervisor/stages/wait-completion.ts`

- Passes `ctx.droneHandle` instead of `ctx.dronePane` to deps.waitForDroneCompletion
- On failure, calls `deps.killDrone(ctx.droneHandle)` instead of `deps.killPane(ctx.dronePane)`

#### `minds/lib/supervisor/pipeline-types.ts`

- StageContext type: `dronePane?: string` becomes `droneHandle?: DroneHandle`
- `allSpawnedPanes: string[]` becomes `allSpawnedHandles: DroneHandle[]`

#### `minds/lib/multiplexer-factory.ts`

**No changes.** The multiplexer factory continues to serve non-drone use cases. Drones use the new DroneBackend factory. This separation is intentional -- the multiplexer abstraction is for pane-like operations; drones need process-lifecycle operations.

#### `minds/lib/axon/multiplexer.ts`

**No changes.** The AxonMultiplexer continues to serve ad-hoc pane operations through the TerminalMultiplexer interface. Drones bypass it entirely.

#### `minds/lib/tmux-utils.ts`

**Minimal changes.** The `killPane`, `splitPane`, `launchClaudeInPane` wrappers remain for backward compatibility. They are not used by the new drone path.

---

## 4. Data Flow Diagrams

### 4.1 Spawn Flow (Axon Backend)

```
drone-pane.ts CLI
    |
    |-- 1. Parse args, resolve repo context
    |-- 2. Create worktree (git worktree add)
    |-- 3. Install dependencies (bun install)
    |-- 4. Write .git/info/exclude
    |-- 5. Assemble + write CLAUDE.md
    |-- 6. Write .claude/settings.json (hooks)
    |-- 7. Write DRONE-BRIEF.md
    |                                              [Steps 1-7 unchanged]
    |
    |-- 8. createDroneBackend(repoRoot)
    |       |
    |       |-- resolveAxonBinary() -> found
    |       |-- startAxonDaemon() -> socket path
    |       |-- AxonClient.connect() -> client
    |       |-- return AxonDroneBackend(client)
    |
    |-- 9. backend.spawn({
    |       processId: "drone-{mind}-{ticket}",
    |       command: "claude",
    |       args: [...],
    |       env: { BUS_URL: "..." },
    |     })
    |       |
    |       |-- AxonClient.spawn() ---------> Axon daemon
    |       |                                   |
    |       |                                   |-- fork/exec claude process
    |       |                                   |-- ring buffer captures output
    |       |                                   |-- event bus tracks state
    |       |
    |       |-- return DroneHandle { id: "drone-arch-BRE-500", backend: "axon" }
    |
    |-- 10. Publish DRONE_SPAWNED event to bus
    |-- 11. Output JSON { drone_handle, worktree, branch, backend: "axon" }
```

### 4.2 Completion Detection Flow (Axon Backend)

```
supervisor (wait-completion stage)
    |
    |-- deps.waitForDroneCompletion(handle, worktree, timeout)
    |       |
    |       |-- handle.backend === "axon"
    |       |
    |       |-- AxonClient.subscribe({ process_ids: [handle.id] })
    |       |       |
    |       |       |-- Axon daemon pushes Exited event when process terminates
    |       |       |-- Event includes exit_code
    |       |       |-- Instant detection (no polling, no sentinel file)
    |       |
    |       |-- return { ok: exitCode === 0, exitCode }
```

### 4.3 Relaunch Flow (Axon Backend)

```
spawn-drone stage (iteration > 1)
    |
    |-- deps.relaunchDroneInWorktree({
    |       oldHandle,
    |       worktreePath,
    |       briefContent,
    |       ...
    |     })
    |       |
    |       |-- backend.kill(oldHandle)
    |       |       |-- AxonClient.kill("drone-arch-BRE-500")
    |       |       |-- Axon daemon sends SIGTERM, cleans up
    |       |
    |       |-- Write updated DRONE-BRIEF.md to worktree
    |       |-- Write REVIEW-FEEDBACK-N.md to worktree
    |       |
    |       |-- backend.spawn({
    |       |       processId: "drone-{mind}-{ticket}-r2",  // iteration suffix
    |       |       cwd: worktreePath,  // same worktree
    |       |       ...
    |       |     })
    |       |       |-- AxonClient.spawn() -> new process in same worktree
    |       |
    |       |-- return new DroneHandle
```

### 4.4 Fallback Flow (tmux Backend)

```
createDroneBackend(repoRoot)
    |
    |-- resolveAxonBinary() -> null (not installed)
    |   OR
    |-- startAxonDaemon() -> throws (failed to start)
    |   OR
    |-- AxonClient.connect() -> throws (socket error)
    |   OR
    |-- MINDS_DRONE_BACKEND=tmux (explicit override)
    |
    |-- return TmuxDroneBackend()
    |
    |-- All downstream operations use existing tmux code path:
    |       splitPane -> sendKeys -> sentinel file -> poll isPaneAlive
```

---

## 5. Answers to Design Questions

### Q1: How should drone-pane.ts change? Does it still create tmux panes as fallback?

Yes. drone-pane.ts uses the DroneBackend factory. When Axon is available, it spawns via AxonClient. When not, it falls back to TmuxDroneBackend which uses the existing splitPane + sendKeys path. The worktree/brief/CLAUDE.md preparation code (lines 1-374) is completely unchanged.

### Q2: How does the supervisor know which backend was used for a drone?

The `DroneHandle` type carries a `backend: "axon" | "tmux"` field. The supervisor passes handles around instead of raw pane ID strings. The handle is opaque to the supervisor -- it just passes it to the DroneBackend methods. The backend field is only needed for conditional logic (skip sentinel hook for Axon, skip trust dialog for Axon).

### Q3: How does relaunch work with Axon?

1. `backend.kill(oldHandle)` sends SIGTERM to the Axon-managed process
2. Write updated DRONE-BRIEF.md and REVIEW-FEEDBACK-N.md to the same worktree
3. `backend.spawn(newOpts)` with a new process ID (append `-r{iteration}`) but the same worktree path as `cwd`
4. Return the new DroneHandle

The Axon daemon handles process lifecycle cleanly -- killing a process frees its slot, and the new spawn gets a fresh ring buffer and event subscription.

### Q4: What happens to the sentinel file mechanism?

**Kept for tmux-backend drones.** When `handle.backend === "tmux"`, the supervisor still:
- Calls `installDroneStopHook()` to write the Stop hook
- Uses sentinel file + poll for completion detection

**Skipped for Axon-backend drones.** Axon provides reliable exit detection via its event bus. The sentinel file is unnecessary overhead. The `installDroneStopHook` call is guarded:

```typescript
if (handle.backend === "tmux") {
  deps.installDroneStopHook(worktree);
}
```

### Q5: Should drone spawning bypass the multiplexer entirely?

**Yes.** The TerminalMultiplexer interface models pane operations (split, sendKeys, capturePane). Drones need process operations (spawn, kill, waitForExit, readOutput). These are semantically different. The new DroneBackend interface captures the correct abstraction. The AxonMultiplexer continues to exist for non-drone multiplexer operations.

### Q6: How do we handle `--setting-sources project,local`?

It becomes a command-line argument passed to Claude Code in the args array:

```typescript
args: [
  "--dangerously-skip-permissions",
  "--model", "sonnet",
  "--setting-sources", "project,local",
  initialPrompt,
]
```

For the Axon backend, these are passed directly to `AxonClient.spawn()` as the args parameter. For the tmux backend, they are assembled into the sendKeys command string (unchanged from today).

### Q7: What is the migration path?

See Section 6 below.

---

## 6. Migration / Rollout Plan

### Phase A: New Abstraction (Non-Breaking)

1. Create `DroneBackend` interface, `AxonDroneBackend`, `TmuxDroneBackend`, factory
2. Write tests for both backends
3. **No existing code changes yet.** Both backends are standalone.

### Phase B: Wire Into drone-pane.ts

1. Replace the `TmuxMultiplexer` usage in drone-pane.ts with `createDroneBackend()`
2. Add `--backend` CLI flag for explicit override
3. Output includes `backend` field in JSON result
4. Test: `MINDS_DRONE_BACKEND=tmux` runs the old path, `MINDS_DRONE_BACKEND=axon` runs the new path

### Phase C: Wire Into Supervisor

1. Update `SupervisorDeps` to use `DroneHandle` instead of `paneId: string`
2. Update `StageContext` (`droneHandle` replaces `dronePane`)
3. Update spawn-drone.ts, wait-completion.ts stage executors
4. Update `relaunchDroneInWorktree` to accept DroneBackend
5. Conditional sentinel hook installation
6. Test: full supervisor E2E with `MINDS_DRONE_BACKEND=axon`

### Phase D: Default Flip

1. Change `"auto"` detection to prefer Axon when available
2. `MINDS_DRONE_BACKEND=tmux` remains the instant rollback escape hatch
3. Monitor in production for one full cycle

### Phase E: Cleanup (Deferred)

1. Remove sentinel file mechanism once tmux fallback is no longer needed
2. Simplify `installDroneStopHook` (the hooks for bus events remain; only the sentinel touch command goes away)

**Each phase is independently shippable. No phase breaks existing functionality.**

---

## 7. Risks and Mitigations

### Risk 1: Claude Code Needs PTY Features

**Risk:** Some Claude Code behavior might depend on PTY/terminal features that Axon's direct spawn does not provide.

**Mitigation:** Already proven false. Testing confirmed Claude Code works with `< /dev/null` and no PTY. The `--setting-sources project,local` flag prevents TUI-dependent global hooks from loading. However, if edge cases emerge, the tmux fallback is one env var away.

### Risk 2: Axon Process ID Collisions

**Risk:** If two drones for the same mind/ticket spawn simultaneously, the process ID `drone-{mind}-{ticket}` could collide.

**Mitigation:** Append the wave ID or a monotonic counter to the process ID: `drone-{mind}-{ticket}-{waveId}`. Axon rejects duplicate IDs with a clear error, so collisions fail fast rather than silently.

### Risk 3: Axon Daemon Crash During Drone Execution

**Risk:** If the Axon daemon crashes while a drone is running, the drone process becomes orphaned (Axon is the parent process).

**Mitigation:**
1. Axon's daemon lifecycle manager auto-restarts on crash (BRE-576)
2. The supervisor has a timeout -- if the drone never completes, the timeout fires
3. The DroneBackend.waitForCompletion can detect client disconnect and treat it as drone failure
4. Orphaned Claude Code processes will eventually exit on their own (stdin is /dev/null, no more input)

### Risk 4: Ring Buffer Size for Long-Running Drones

**Risk:** Claude Code drones can run for 30+ minutes with substantial output. The Axon ring buffer might be too small.

**Mitigation:** Axon's ring buffer is configurable. 64KB default is likely sufficient since drone output capture is primarily for diagnostics, not for processing the full output. If needed, increase per-process.

### Risk 5: Multiple AxonClient Connections

**Risk:** drone-pane.ts creates a DroneBackend (with an AxonClient), and the supervisor creates another for completion detection. Multiple clients to the same daemon is fine, but each holds a socket.

**Mitigation:** The DroneBackend factory should be called once per supervisor run and the instance threaded through. drone-pane.ts creates its own short-lived instance (closes after spawn). The supervisor holds one for the full lifecycle. This is already the pattern -- drone-pane.ts is a separate process invocation.

### Risk 6: Backward Compatibility of SupervisorDeps

**Risk:** Changing `paneId: string` to `DroneHandle` in SupervisorDeps breaks all existing test mocks.

**Mitigation:** DroneHandle is `{ id: string; backend: "axon" | "tmux" }`. Test mocks just need to wrap their string IDs: `{ id: "%42", backend: "tmux" }`. This is a mechanical change. Provide a helper: `mockHandle(id: string): DroneHandle`.

---

## 8. What Does NOT Change

To be explicit about scope -- the following are NOT touched:

- Worktree creation/management (git worktree add, cleanup)
- CLAUDE.md assembly (`assembleClaudeContent`)
- DRONE-BRIEF.md writing
- Hook installation for bus events (settings.json hooks for SubagentStart, etc.)
- .git/info/exclude management
- Dependency installation (bun install)
- The Minds bus event system (DRONE_SPAWNED, etc.)
- The supervisor state machine (INIT -> DRONE_RUNNING -> CHECKING -> etc.)
- The review/feedback loop
- The pipeline stage executor framework
- The AxonMultiplexer class (serves non-drone use cases)
- The multiplexer-factory.ts (serves non-drone use cases)

---

## 9. Process ID Naming Convention

Axon process IDs must match `[a-zA-Z0-9_-]{1,64}`. Proposed convention for drones:

```
drone-{mind}-{ticket}-{waveId}[-r{iteration}]
```

Examples:
- `drone-arch-BRE-500-w1` (first spawn)
- `drone-arch-BRE-500-w1-r2` (relaunch iteration 2)
- `drone-test-BRE-501-w3` (different mind, wave 3)

The ticket ID may contain characters that need sanitization (the existing `sanitizeProcessId` handles this).

---

## 10. Environment Variable Summary

| Variable | Values | Purpose |
|----------|--------|---------|
| `MINDS_DRONE_BACKEND` | `axon`, `tmux`, unset | Explicit drone backend selection. Takes priority. |
| `MINDS_MULTIPLEXER` | `axon`, `tmux`, unset | Existing multiplexer selection. Used as fallback if MINDS_DRONE_BACKEND is unset. |
| `CLAUDECODE` | unset | Must be unset for headless Claude Code (prevents TUI initialization). |

The two env vars are intentionally separate. `MINDS_MULTIPLEXER` controls the TerminalMultiplexer for non-drone operations. `MINDS_DRONE_BACKEND` controls drone spawning specifically. When `MINDS_DRONE_BACKEND` is unset, it falls back to `MINDS_MULTIPLEXER`, then auto-detection.

---

## 11. Testing Strategy

### Unit Tests
- `AxonDroneBackend`: mock AxonClient, verify spawn/kill/wait/capture calls
- `TmuxDroneBackend`: mock TmuxMultiplexer, verify existing behavior preserved
- `createDroneBackend`: test env var parsing, auto-detection, fallback

### Integration Tests (BRE-581)
- Spawn a real Claude Code drone via Axon, verify exit detection
- Relaunch in same worktree, verify new process ID, verify old killed
- Kill mid-execution, verify clean cleanup
- Daemon crash during drone execution, verify supervisor timeout recovery

### E2E Tests
- Full supervisor cycle with `MINDS_DRONE_BACKEND=axon`
- Full supervisor cycle with `MINDS_DRONE_BACKEND=tmux` (regression)
- Backend auto-detection with Axon installed
- Backend auto-detection without Axon installed (tmux fallback)
