/**
 * supervisor-types.ts — Shared types, enums, and constants for the
 * deterministic Mind supervisor.
 */

import type { MindTask } from "../cli/lib/implement-types.ts";
import type { MindsEventType } from "../transport/minds-events.ts";

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
  dronePaneId?: string;
  /** All drone pane IDs spawned across iterations (tracked for cleanup). */
  allPaneIds: string[];
  worktree: string;
  branch: string;
  errors: string[];
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
}

/**
 * Injectable dependencies for runMindSupervisor. Production code uses the
 * real implementations; tests inject mocks for isolated integration testing.
 */
export interface SupervisorDeps {
  /** Spawn a drone in a new worktree (first iteration). */
  spawnDrone: (config: SupervisorConfig, briefContent: string) => Promise<{
    paneId: string;
    worktree: string;
    branch: string;
  }>;

  /** Re-launch a drone in an existing worktree (subsequent iterations). */
  relaunchDroneInWorktree: (opts: {
    oldPaneId: string;
    callerPane: string;
    worktreePath: string;
    briefContent: string;
    busUrl: string;
    mindName: string;
  }) => string;

  /** Wait for drone completion (sentinel file + poll). */
  waitForDroneCompletion: (
    paneId: string,
    worktreePath: string,
    timeoutMs: number,
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

  /** Run deterministic checks (git diff + bun test). */
  runDeterministicChecks: (
    worktreePath: string,
    baseBranch: string,
    mindName: string,
  ) => CheckResults;

  /** Call LLM for code review. */
  callLlmReview: (prompt: string, timeoutMs: number) => Promise<string>;

  /** Install the drone Stop hook for sentinel-based completion detection. */
  installDroneStopHook: (worktreePath: string) => void;

  /** Kill a tmux pane. */
  killPane: (paneId: string) => void;
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

export const DEFAULT_REVIEW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_DRONE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const SENTINEL_FILENAME = ".drone-complete";
export const MAX_DIFF_CHARS = 50_000;
export const MAX_TEST_OUTPUT_CHARS = 20_000;
