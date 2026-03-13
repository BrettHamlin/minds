/**
 * wait-completion.ts — Stage executor for waiting on drone completion.
 *
 * Delegates to deps.waitForDroneCompletion. On failure, kills the drone
 * pane and returns a terminal error to stop the pipeline.
 */

import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";

export const executeWaitCompletion = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const { deps, dronePane, worktree, supervisorConfig: config } = ctx;

  const completion = await deps.waitForDroneCompletion(
    dronePane!,
    worktree,
    config.droneTimeoutMs,
  );

  if (!completion.ok) {
    const error = completion.error ?? "Drone failed";
    await deps.killPane(dronePane!);
    return { ok: false, terminal: true, error };
  }

  return { ok: true };
};
