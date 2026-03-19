/**
 * contract-check.ts — Stage executor that evaluates contract check results.
 *
 * Reads ctx.checkResults.contractsPass and ctx.checkResults.contractFindings.
 * Returns pass/fail with contract findings. If the check was skipped
 * (contractsPass is undefined), returns ok.
 *
 * Propagates deferredCrossRepoAnnotations to ctx.store for later use.
 */

import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";

export const executeContractCheck = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  if (!ctx.checkResults) {
    return {
      ok: false,
      error: "No check results available — git-diff stage must run first",
    };
  }

  // Propagate deferred cross-repo annotations to store
  if (ctx.checkResults.deferredCrossRepoAnnotations?.length) {
    ctx.store.deferredCrossRepoAnnotations = ctx.checkResults.deferredCrossRepoAnnotations;
  }

  // Contract check was skipped (no tasks with produces/consumes annotations)
  if (ctx.checkResults.contractsPass === undefined) {
    return { ok: true };
  }

  if (ctx.checkResults.contractsPass) {
    return { ok: true };
  }

  return {
    ok: false,
    findings: ctx.checkResults.contractFindings ?? [],
  };
};
