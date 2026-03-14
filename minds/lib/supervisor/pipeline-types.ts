/**
 * pipeline-types.ts — Core type system for mind-declared pipelines.
 *
 * Minds declare their own execution pipelines as typed, ordered lists of stages.
 * Each stage maps to a StageExecutor via the stage registry. This replaces the
 * hardcoded code-only supervisor flow with a generic, extensible pipeline system.
 *
 * Resolution order: explicit `pipeline` > `pipeline_template` > default "code"
 */

import type { SupervisorConfig, SupervisorDeps, CheckResults, ReviewFinding, ReviewVerdict } from "./supervisor-types.ts";
import type { DroneHandle } from "../drone-backend.ts";

// ---------------------------------------------------------------------------
// Pipeline stage definition
// ---------------------------------------------------------------------------

export interface PipelineStage {
  /** Registry key — determines which executor runs this stage. */
  type: string;
  /** Human-readable label for logging and dashboard display. */
  label?: string;
  /** Failure policy: "reject" stops pipeline, "warn" continues, "skip" is silent. Default: "reject". */
  on_fail?: "reject" | "warn" | "skip";
  /** Stage-specific configuration parameters. */
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stage execution context and result
// ---------------------------------------------------------------------------

export interface StageContext {
  readonly supervisorConfig: SupervisorConfig;
  readonly deps: SupervisorDeps;
  readonly standards: string;
  readonly iteration: number;
  droneHandle?: DroneHandle;
  worktree: string;
  branch: string;
  checkResults?: CheckResults;
  verdict?: ReviewVerdict;
  previousFeedback?: string;
  /** Arbitrary key-value store for inter-stage communication within a pipeline run. */
  store: Record<string, unknown>;
  /** All drone handles spawned across iterations (for cleanup tracking). */
  allDroneHandles: DroneHandle[];
}

export interface StageResult {
  ok: boolean;
  error?: string;
  findings?: ReviewFinding[];
  /** When true, the pipeline should stop regardless of on_fail policy. */
  terminal?: boolean;
  /** Review verdict: true = approved, false = rejected. */
  approved?: boolean;
}

// ---------------------------------------------------------------------------
// Stage executor function signature
// ---------------------------------------------------------------------------

/**
 * A stage executor receives the stage definition and shared context,
 * then performs its work and returns a result.
 */
export type StageExecutor = (stage: PipelineStage, ctx: StageContext) => Promise<StageResult>;
