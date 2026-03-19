/**
 * boundary-check.ts — Stage executor that evaluates boundary check results.
 *
 * Reads ctx.checkResults.boundaryPass and ctx.checkResults.boundaryFindings.
 * Returns pass/fail with boundary findings. If the check was skipped
 * (boundaryPass is undefined), returns ok.
 */

import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";

export const executeBoundaryCheck = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  if (!ctx.checkResults) {
    return {
      ok: false,
      error: "No check results available — git-diff stage must run first",
    };
  }

  // Boundary check was skipped (no owns_files, no diff, etc.)
  if (ctx.checkResults.boundaryPass === undefined) {
    return { ok: true };
  }

  if (ctx.checkResults.boundaryPass) {
    return { ok: true };
  }

  return {
    ok: false,
    findings: ctx.checkResults.boundaryFindings ?? [],
  };
};
