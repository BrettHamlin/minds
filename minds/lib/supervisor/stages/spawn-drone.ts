/**
 * spawn-drone.ts — Stage executor for spawning or re-launching a drone.
 *
 * Iteration 1: Spawns a new drone via deps.spawnDrone (creates worktree).
 * Iteration > 1: Re-launches drone in existing worktree via deps.relaunchDroneInWorktree.
 *
 * Updates StageContext with droneHandle, worktree, branch, and allDroneHandles.
 */

import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";
import { errorMessage } from "../supervisor-types.ts";
import { buildSupervisorDroneBrief } from "../supervisor-drone.ts";

export const executeSpawnDrone = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const { supervisorConfig: config, deps, iteration } = ctx;

  if (iteration === 1) {
    // First iteration: spawn drone (creates worktree)
    const briefContent = buildSupervisorDroneBrief(config);

    let drone: { handle: import("../../drone-backend.ts").DroneHandle; worktree: string; branch: string };
    try {
      drone = await deps.spawnDrone(config, briefContent);
    } catch (err) {
      return {
        ok: false,
        terminal: true,
        error: `Failed to spawn drone: ${errorMessage(err)}`,
      };
    }

    ctx.droneHandle = drone.handle;
    ctx.allDroneHandles.push(drone.handle);
    ctx.worktree = drone.worktree;
    ctx.branch = drone.branch;

    // Install the Stop hook for sentinel-based completion detection
    deps.installDroneStopHook(drone.worktree);

    // Auto-accept workspace trust dialog (fires after Claude Code loads).
    // Only needed for tmux backend — axon backend runs headless.
    if (drone.handle.backend === "tmux") {
      const { TmuxMultiplexer } = await import("../../tmux-multiplexer.ts");
      setTimeout(async () => {
        try { await new TmuxMultiplexer().sendKeys(drone.handle.id, ""); } catch { /* pane may be gone */ }
      }, 3000);
    }

    return { ok: true };
  }

  // Subsequent iterations: re-launch drone in the SAME worktree
  const feedbackFile = `REVIEW-FEEDBACK-${iteration - 1}.md`;
  const briefContent = buildSupervisorDroneBrief(config, feedbackFile);

  try {
    const newHandle = await deps.relaunchDroneInWorktree({
      oldHandle: ctx.droneHandle!,
      callerPane: config.callerPane,
      worktreePath: ctx.worktree,
      briefContent,
      busUrl: config.busUrl,
      mindName: config.mindName,
    });
    ctx.droneHandle = newHandle;
    ctx.allDroneHandles.push(newHandle);

    // Reinstall the Stop hook (sentinel file was consumed by previous iteration)
    deps.installDroneStopHook(ctx.worktree);

    // Auto-accept workspace trust dialog for re-launched drone (tmux only)
    if (newHandle.backend === "tmux") {
      const { TmuxMultiplexer } = await import("../../tmux-multiplexer.ts");
      setTimeout(async () => {
        try { await new TmuxMultiplexer().sendKeys(newHandle.id, ""); } catch { /* pane may be gone */ }
      }, 3000);
    }
  } catch (err) {
    return {
      ok: false,
      terminal: true,
      error: `Failed to re-launch drone: ${errorMessage(err)}`,
    };
  }

  return { ok: true };
};
