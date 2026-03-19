/**
 * pipeline-runner.ts — Generic pipeline stage runner.
 *
 * Iterates through an ordered list of PipelineStage definitions, resolving
 * each stage's executor from the stage registry and executing it with shared
 * context. Handles on_fail policies and terminal results.
 *
 * The supervisor owns the retry loop, signal publishing, and result
 * construction. This runner handles the per-iteration stage execution.
 */

import type { PipelineStage, StageContext, StageResult } from "./pipeline-types.ts";
import type { ReviewFinding } from "./supervisor-types.ts";
import { getExecutor } from "./stage-registry.ts";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface PipelineRunResult {
  /** Overall pipeline success: true if no stage caused a pipeline stop. */
  ok: boolean;
  /** Accumulated findings from all stages. */
  findings: ReviewFinding[];
  /** Per-stage results in execution order. */
  stageResults: StageResult[];
  /** True if a review stage explicitly approved. */
  approved?: boolean;
  /** Error message if the pipeline stopped due to failure. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Pipeline runner
// ---------------------------------------------------------------------------

/**
 * Run a pipeline: iterate through stages in order, calling each stage's
 * registered executor with the shared context.
 *
 * Behavior:
 *   - If a stage returns `terminal: true`, the pipeline stops immediately
 *     regardless of the stage's on_fail policy.
 *   - If a stage fails (`ok: false`) and on_fail is:
 *       "reject" (default) → stop the pipeline, mark result as failed
 *       "warn"             → log warning, accumulate findings, continue
 *       "skip"             → accumulate findings silently, continue
 *   - Stage context is shared and mutable across all stages.
 *   - Findings from all stages are accumulated in the result.
 */
export async function runPipeline(
  stages: readonly PipelineStage[],
  ctx: StageContext,
): Promise<PipelineRunResult> {
  const allFindings: ReviewFinding[] = [];
  const stageResults: StageResult[] = [];
  let approved: boolean | undefined;

  for (const stage of stages) {
    const executor = getExecutor(stage.type);
    const result = await executor(stage, ctx);
    stageResults.push(result);

    // Accumulate findings from this stage
    if (result.findings?.length) {
      allFindings.push(...result.findings);
    }

    // Track the latest approved flag from any stage that sets it
    if (result.approved !== undefined) {
      approved = result.approved;
    }

    // Terminal results stop the pipeline unconditionally
    if (result.terminal) {
      return {
        ok: false,
        findings: allFindings,
        stageResults,
        approved: false,
        error: result.error,
      };
    }

    // Handle failure based on on_fail policy
    if (!result.ok) {
      const policy = stage.on_fail ?? "reject";

      if (policy === "reject") {
        return {
          ok: false,
          findings: allFindings,
          stageResults,
          approved: result.approved ?? false,
          error: result.error,
        };
      }

      // "warn" and "skip" both continue — warn just logs
      if (policy === "warn") {
        const label = stage.label ?? stage.type;
        console.log(
          `[pipeline] Stage "${label}" failed with warnings: ${result.error ?? "no details"}`,
        );
      }
      // "skip" — silently continue (findings are still accumulated above)
    }
  }

  return {
    ok: true,
    findings: allFindings,
    stageResults,
    approved,
  };
}
