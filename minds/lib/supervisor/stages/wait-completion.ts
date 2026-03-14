/**
 * wait-completion.ts — Stage executor for waiting on drone completion.
 *
 * Delegates to deps.waitForDroneCompletion. On failure, kills the drone
 * and returns a terminal error to stop the pipeline.
 */

import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";

export const executeWaitCompletion = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const { deps, droneHandle, worktree, supervisorConfig: config } = ctx;

  const completion = await deps.waitForDroneCompletion(
    droneHandle!,
    worktree,
    config.droneTimeoutMs,
    undefined, // use default poll interval
    config.repoRoot,
  );

  if (!completion.ok) {
    const error = completion.error ?? "Drone failed";
    await deps.killDrone(droneHandle!);
    return { ok: false, terminal: true, error };
  }

  return { ok: true };
};
