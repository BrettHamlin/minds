/**
 * run-tests.ts — Stage executor that evaluates test results from ctx.checkResults.
 *
 * Does NOT run tests itself — the git-diff stage already ran them as part
 * of runDeterministicChecks. This stage reads ctx.checkResults.testsPass
 * and returns pass/fail with appropriate findings.
 */

import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";

export const executeRunTests = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  if (!ctx.checkResults) {
    return {
      ok: false,
      error: "No check results available — git-diff stage must run first",
    };
  }

  if (ctx.checkResults.testsPass) {
    return { ok: true };
  }

  return {
    ok: false,
    findings: [
      {
        file: "(tests)",
        line: 0,
        severity: "error",
        message: "Tests are failing. Fix all test failures before approval.",
      },
    ],
  };
};
