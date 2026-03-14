/**
 * supervisor-types.ts — Shared types, enums, and constants for the
 * deterministic Mind supervisor.
 */

import type { MindTask } from "../../cli/lib/implement-types.ts";
import type { MindsEventType } from "../../transport/minds-events.ts";
import type { ContractAnnotation } from "../check-contracts-core.ts";
import type { DroneHandle } from "../drone-backend.ts";

// ---------------------------------------------------------------------------
// State enum
// ---------------------------------------------------------------------------

export enum SupervisorState {
  INIT = "INIT",
  DRONE_RUNNING = "DRONE_RUNNING",
  CHECKING = "CHECKING",
  REVIEWING = "REVIEWING",
  DONE = "DONE",
  FAILED = "FAILED",
}

// ---------------------------------------------------------------------------
// Config & result interfaces
// ---------------------------------------------------------------------------

export interface SupervisorConfig {
  mindName: string;
  ticketId: string;
  waveId: string;
  tasks: MindTask[];
  repoRoot: string;
  busUrl: string;
  busPort: number;
  channel: string;
  worktreePath: string;
  baseBranch: string;
  callerPane: string;
  mindsSourceDir: string;
  featureDir: string;
  dependencies: string[];
  maxIterations: number;
  droneTimeoutMs: number;
  reviewTimeoutMs?: number;
  /** Pre-resolved owns_files from the main repo's minds.json (worktrees may not have it). */
  ownsFiles?: string[];
  /** When true, empty ownsFiles is a hard error in boundary check (for unregistered minds). */
  requireBoundary?: boolean;
  /** Repo alias for multi-repo workspaces. */
  repo?: string;
  /** Absolute path to this mind's repo (may differ from repoRoot in multi-repo). */
  mindRepoRoot?: string;
  /** Per-repo test command (default: "bun test"). */
  testCommand?: string;
  /** Per-repo install command (default: "bun install"). */
  installCommand?: string;
  /** Additional infrastructure exclusion patterns (merged with defaults in boundary check). */
  infraExclusions?: string[];
  /** Explicit pipeline stages for this mind (from MindDescription). */
  pipeline?: import("./pipeline-types.ts").PipelineStage[];
  /** Named pipeline template (e.g. "code", "build", "test"). */
  pipelineTemplate?: string;
}

export interface ReviewFinding {
  file: string;
  line: number;
  severity: "error" | "warning";
  message: string;
  /** Which supervisor iteration produced this finding (1-based). */
  iteration?: number;
}

export interface ReviewVerdict {
  approved: boolean;
  findings: ReviewFinding[];
}

export interface SupervisorResult {
  ok: boolean;
  iterations: number;
  approved: boolean;
  approvedWithWarnings: boolean;
  findings: ReviewFinding[];
  /** ID of the most recent drone (backward compat alias). */
  droneId?: string;
  /** All drone handles spawned across iterations (tracked for cleanup). */
  allDroneHandles: DroneHandle[];
  /** Total number of drones spawned across all iterations. */
  totalDronesSpawned: number;
  worktree: string;
  branch: string;
  errors: string[];
  /** Cross-repo contract annotations deferred for post-wave verification. */
  deferredCrossRepoAnnotations?: ContractAnnotation[];
}

// ---------------------------------------------------------------------------
// State machine interface
// ---------------------------------------------------------------------------

export interface StateMachine {
  getState(): SupervisorState;
  transition(to: SupervisorState): void;
  getIteration(): number;
  incrementIteration(): number;
  isMaxIterations(): boolean;
}

// ---------------------------------------------------------------------------
// Dependency injection interface (for testing)
// ---------------------------------------------------------------------------

export interface CheckResults {
  diff: string;
  testOutput: string;
  testsPass: boolean;
  findings: ReviewFinding[];
  /** Whether all contract annotations are satisfied. Undefined if check was skipped. */
  contractsPass?: boolean;
  contractFindings?: ReviewFinding[];
  /** Whether all modified files are within the Mind's boundary. Undefined if check was skipped. */
  boundaryPass?: boolean;
  boundaryFindings?: ReviewFinding[];
  /** The owns_files list for the Mind (from minds.json). Flows to agent generation. */
  ownsFiles?: string[];
  /** Cross-repo contract annotations deferred for post-wave verification. */
  deferredCrossRepoAnnotations?: ContractAnnotation[];
}

/**
 * Injectable dependencies for runMindSupervisor. Production code uses the
 * real implementations; tests inject mocks for isolated integration testing.
 */
export interface SupervisorDeps {
  /** Spawn a drone in a new worktree (first iteration). */
  spawnDrone: (config: SupervisorConfig, briefContent: string) => Promise<{
    handle: DroneHandle;
    worktree: string;
    branch: string;
  }>;

  /** Re-launch a drone in an existing worktree (subsequent iterations). */
  relaunchDroneInWorktree: (opts: {
    oldHandle: DroneHandle;
    callerPane: string;
    worktreePath: string;
    briefContent: string;
    busUrl: string;
    mindName: string;
  }) => Promise<DroneHandle>;

  /** Wait for drone completion (sentinel file + poll or Axon event). */
  waitForDroneCompletion: (
    handle: DroneHandle,
    worktreePath: string,
    timeoutMs: number,
    pollIntervalMs?: number,
    repoRoot?: string,
  ) => Promise<{ ok: boolean; error?: string }>;

  /** Publish a signal to the bus. */
  publishSignal: (
    busUrl: string,
    channel: string,
    type: MindsEventType,
    mindName: string,
    waveId: string,
    extra?: Record<string, unknown>,
  ) => Promise<void>;

  /** Run deterministic checks (git diff + bun test + boundary + contracts). */
  runDeterministicChecks: (
    options: import("./supervisor-checks.ts").DeterministicCheckOptions,
  ) => CheckResults;

  /** Call LLM for code review. */
  callLlmReview: (prompt: string, timeoutMs: number, opts?: { worktreePath?: string; agentName?: string }) => Promise<string>;

  /** Install the drone Stop hook for sentinel-based completion detection. */
  installDroneStopHook: (worktreePath: string) => void;

  /** Kill a drone. */
  killDrone: (handle: DroneHandle) => Promise<void>;

  /** Delay between retry iterations (injectable for testing). */
  delay: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Safely extract a message string from an unknown thrown value.
 * Handles both Error instances and non-Error throws (strings, numbers, etc.).
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_REVIEW_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (Opus + tool use)
export const SENTINEL_FILENAME = ".drone-complete";
export const MAX_DIFF_CHARS = 50_000;
export const MAX_TEST_OUTPUT_CHARS = 20_000;

/** Base delay (ms) before retrying after a review rejection. */
export const BASE_RETRY_BACKOFF_MS = 5_000;
/** Multiplier applied per iteration: delay = BASE * MULTIPLIER^(iteration-1). */
export const BACKOFF_MULTIPLIER = 3;
/** Maximum backoff delay (ms). Caps exponential growth for high maxIterations. */
export const MAX_BACKOFF_MS = 60_000;
