/**
 * spawn-drone.ts — Stage executor for spawning or re-launching a drone.
 *
 * Iteration 1: Spawns a new drone via deps.spawnDrone (creates worktree).
 * Iteration > 1: Re-launches drone in existing worktree via deps.relaunchDroneInWorktree.
 *
 * Updates StageContext with droneHandle, worktree, branch, and allDroneHandles.
 */

import type { DroneHandle } from "../../drone-backend.ts";
import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";
import { errorMessage } from "../supervisor-types.ts";
import { buildSupervisorDroneBrief } from "../supervisor-drone.ts";

/**
 * Auto-accept Claude Code's workspace trust dialog after a delay.
 *
 * Claude Code shows a "trust this folder?" prompt when opening a new
 * workspace. Both tmux and Axon backends spawn with a PTY, so the
 * dialog appears in both. This sends an Enter keypress to dismiss it.
 *
 * Best-effort: errors are silently caught (drone may have skipped the
 * dialog, already exited, or the socket may be unavailable).
 */
function autoAcceptTrustDialog(
  handle: DroneHandle,
  repoRoot: string,
  delayMs = 3000,
): void {
  setTimeout(async () => {
    try {
      if (handle.backend === "tmux") {
        const { TmuxMultiplexer } = await import("../../tmux-multiplexer.ts");
        await new TmuxMultiplexer().sendKeys(handle.id, "");
      } else if (handle.backend === "axon") {
        const { AxonClient } = await import("../../axon/client.ts");
        const { getDaemonPaths } = await import("../../axon/daemon-lifecycle.ts");
        const socketPath = process.env.AXON_SOCKET ??
          getDaemonPaths(repoRoot).socketPath;
        const client = await AxonClient.connect(socketPath);
        try {
          await client.writeInput(handle.id, "\r");
        } finally {
          client.close();
        }
      }
    } catch { /* best-effort: drone may have skipped the dialog or already exited */ }
  }, delayMs);
}

export const executeSpawnDrone = async (
  _stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const { supervisorConfig: config, deps, iteration } = ctx;

  if (iteration === 1) {
    // First iteration: spawn drone (creates worktree)
    const briefContent = buildSupervisorDroneBrief(config);

    let drone: { handle: DroneHandle; worktree: string; branch: string };
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

    // Auto-accept workspace trust dialog (fires after Claude Code loads)
    autoAcceptTrustDialog(drone.handle, config.repoRoot);

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
      repoRoot: config.repoRoot,
    });
    ctx.droneHandle = newHandle;
    ctx.allDroneHandles.push(newHandle);

    // Reinstall the Stop hook (sentinel file was consumed by previous iteration)
    deps.installDroneStopHook(ctx.worktree);

    // Auto-accept workspace trust dialog for re-launched drone
    autoAcceptTrustDialog(newHandle, config.repoRoot);
  } catch (err) {
    return {
      ok: false,
      terminal: true,
      error: `Failed to re-launch drone: ${errorMessage(err)}`,
    };
  }

  return { ok: true };
};
