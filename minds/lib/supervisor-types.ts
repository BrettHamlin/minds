/**
 * supervisor-types.ts — Shared types, enums, and constants for the
 * deterministic Mind supervisor.
 */

import type { MindTask } from "../cli/lib/implement-types.ts";

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
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_REVIEW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_DRONE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const SENTINEL_FILENAME = ".drone-complete";
export const MAX_DIFF_CHARS = 50_000;
