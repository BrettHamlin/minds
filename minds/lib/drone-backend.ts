/**
 * drone-backend.ts -- DroneBackend abstraction for drone management.
 *
 * Defines the interface for spawning, monitoring, and managing Claude Code
 * drone processes. Implementations include TmuxDroneBackend (existing tmux
 * path) and AxonDroneBackend (event-based via Axon daemon).
 */

/** Handle to a running drone process. */
export interface DroneHandle {
  /** Identifier for this drone (tmux pane ID or Axon process ID). */
  id: string;
  /** Which backend manages this drone. */
  backend: "axon" | "tmux";
}

/** Options for spawning a drone. */
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

/** Completion result from a drone. */
export interface DroneCompletionResult {
  ok: boolean;
  exitCode?: number;
  error?: string;
}

/** Backend interface for drone lifecycle management. */
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
  ): Promise<DroneCompletionResult>;

  /** Check if a drone is still running. */
  isAlive(handle: DroneHandle): Promise<boolean>;

  /** Capture drone output (for diagnostics/logging). */
  captureOutput(handle: DroneHandle): Promise<string>;

  /** Release resources (close sockets, etc). */
  close(): void;
}
