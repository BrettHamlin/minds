/**
 * spawn-drone.ts — Stage executor for spawning or re-launching a drone.
 *
 * Iteration 1: Spawns a new drone via deps.spawnDrone (creates worktree).
 * Iteration > 1: Re-launches drone in existing worktree via deps.relaunchDroneInWorktree.
 *
 * Updates StageContext with dronePane, worktree, branch, and allSpawnedPanes.
 */

import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";
import { errorMessage } from "../supervisor-types.ts";
import { buildSupervisorDroneBrief } from "../supervisor-drone.ts";
import { TmuxMultiplexer } from "../../tmux-multiplexer.ts";

export const executeSpawnDrone = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const { supervisorConfig: config, deps, iteration } = ctx;

  if (iteration === 1) {
    // First iteration: spawn drone (creates worktree)
    const briefContent = buildSupervisorDroneBrief(config);

    let drone: { paneId: string; worktree: string; branch: string };
    try {
      drone = await deps.spawnDrone(config, briefContent);
    } catch (err) {
      return {
        ok: false,
        terminal: true,
        error: `Failed to spawn drone: ${errorMessage(err)}`,
      };
    }

    ctx.dronePane = drone.paneId;
    ctx.allSpawnedPanes.push(drone.paneId);
    ctx.worktree = drone.worktree;
    ctx.branch = drone.branch;

    // Install the Stop hook for sentinel-based completion detection
    deps.installDroneStopHook(drone.worktree);

    // Auto-accept workspace trust dialog (fires after Claude Code loads).
    setTimeout(async () => {
      try { await new TmuxMultiplexer().sendKeys(drone.paneId, ""); } catch { /* pane may be gone */ }
    }, 3000);

    return { ok: true };
  }

  // Subsequent iterations: re-launch drone in the SAME worktree
  const feedbackFile = `REVIEW-FEEDBACK-${iteration - 1}.md`;
  const briefContent = buildSupervisorDroneBrief(config, feedbackFile);

  try {
    const newPaneId = await deps.relaunchDroneInWorktree({
      oldPaneId: ctx.dronePane!,
      callerPane: config.callerPane,
      worktreePath: ctx.worktree,
      briefContent,
      busUrl: config.busUrl,
      mindName: config.mindName,
    });
    ctx.dronePane = newPaneId;
    ctx.allSpawnedPanes.push(newPaneId);

    // Reinstall the Stop hook (sentinel file was consumed by previous iteration)
    deps.installDroneStopHook(ctx.worktree);

    // Auto-accept workspace trust dialog for re-launched drone
    setTimeout(async () => {
      try { await new TmuxMultiplexer().sendKeys(newPaneId, ""); } catch { /* pane may be gone */ }
    }, 3000);
  } catch (err) {
    return {
      ok: false,
      terminal: true,
      error: `Failed to re-launch drone: ${errorMessage(err)}`,
    };
  }

  return { ok: true };
};
