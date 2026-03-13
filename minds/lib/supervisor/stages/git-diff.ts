/**
 * git-diff.ts — Stage executor that runs ALL deterministic checks.
 *
 * Delegates to deps.runDeterministicChecks (git diff + tests + boundary + contracts).
 * Stores the full CheckResults in ctx.checkResults for subsequent stages to evaluate.
 * Also publishes the REVIEW_STARTED signal.
 *
 * Always returns { ok: true } — individual check results are evaluated
 * by the run-tests, boundary-check, and contract-check stages.
 */

import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";
import { MindsEventType } from "../../../transport/minds-events.ts";

export const executeGitDiff = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const { deps, worktree, supervisorConfig: config, iteration } = ctx;

  // Run all deterministic checks
  const checks = deps.runDeterministicChecks({
    worktreePath: worktree,
    baseBranch: config.baseBranch,
    mindName: config.mindName,
    tasks: config.tasks,
    configOwnsFiles: config.ownsFiles,
    requireBoundary: config.requireBoundary,
    testCommand: config.testCommand,
    infraExclusions: config.infraExclusions,
    repo: config.repo,
  });

  ctx.checkResults = checks;

  // Publish REVIEW_STARTED signal
  await deps.publishSignal(
    config.busUrl,
    config.channel,
    MindsEventType.REVIEW_STARTED,
    config.mindName,
    config.waveId,
    { iteration },
  );

  return { ok: true };
};
