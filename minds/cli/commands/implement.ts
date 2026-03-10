/**
 * implement.ts -- CLI command handler for `minds implement <ticket-id>`.
 *
 * Deterministic orchestrator that replaces the markdown-driven
 * minds.implement.md slash command. 100% TypeScript, zero LLM calls.
 *
 * Steps:
 *   0. Cleanup stale context (orphaned bus processes)
 *   1. Load Mind registry from .minds/minds.json
 *   2. Resolve feature directory (scan specs/ for ticket ID match)
 *   3. Parse and group tasks from tasks.md
 *   4. Compute execution waves
 *   5. Display dispatch plan
 *   6. Start bus server
 *   7. For each wave, dispatch drones and wait for completion
 *   8. Between waves: kill drone panes (keep worktrees for merge)
 *   9. After all waves: merge each drone's worktree
 *  10. Report final status
 *  11. Cleanup: teardown bus, remove worktrees
 */

import { existsSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { parseAndGroupTasks } from "../lib/task-parser.ts";
import { computeWaves, formatWavePlan } from "../lib/wave-planner.ts";
import { runMindSupervisor } from "../../lib/mind-supervisor.ts";
import type { SupervisorConfig } from "../../lib/mind-supervisor.ts";
import { waitForWaveCompletion } from "../lib/bus-listener.ts";
import {
  startMindsBus,
  teardownMindsBus,
  findOrphanedBusStates,
  clearBusState,
} from "../../transport/minds-bus-lifecycle.ts";
import { publishWaveStarted, publishWaveComplete } from "../../transport/wave-event.ts";
import { cleanupDroneWorktree } from "../../lib/cleanup.ts";
import { resolveMindsDir } from "../../shared/paths.js";
import { ensureDashboardBuilt } from "../../shared/build-dashboard.js";
import type {
  ImplementOptions,
  ImplementResult,
  MindInfo,
} from "../lib/implement-types.ts";

/**
 * Resolve the source minds directory (where scripts live).
 * This is always the `minds/` directory in the gravitas repo.
 */
function resolveMindsSourceDir(): string {
  // This file is at minds/cli/commands/implement.ts
  // Source dir is minds/
  return resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
}

function getRepoRoot(): string {
  const proc = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
  });
  return new TextDecoder().decode(proc.stdout).trim();
}

/* ------------------------------------------------------------------ */
/*  Feature directory resolution                                       */
/* ------------------------------------------------------------------ */

/**
 * Scan specs/ directory for a subdirectory containing the ticket ID.
 * Returns the absolute path to the feature directory, or null.
 */
function resolveFeatureDir(repoRoot: string, ticketId: string): string | null {
  const specsDir = join(repoRoot, "specs");
  if (!existsSync(specsDir)) return null;

  const entries = readdirSync(specsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.includes(ticketId)) {
      return join(specsDir, entry.name);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Tmux helpers                                                       */
/* ------------------------------------------------------------------ */

function getCurrentPane(): string {
  // Prefer $TMUX_PANE — it's set per-pane and always identifies the pane
  // where the process is running. tmux display-message returns the FOCUSED
  // pane which may be a completely different window.
  if (process.env.TMUX_PANE) return process.env.TMUX_PANE;
  try {
    const proc = Bun.spawnSync(["tmux", "display-message", "-p", "#{pane_id}"], {
      stdout: "pipe",
    });
    return new TextDecoder().decode(proc.stdout).trim() || "";
  } catch {
    return "";
  }
}

function killPane(paneId: string): void {
  try {
    Bun.spawnSync(["tmux", "kill-pane", "-t", paneId], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Pane may already be gone
  }
}

/* ------------------------------------------------------------------ */
/*  Mind spawning                                                      */
/* ------------------------------------------------------------------ */

/**
 * Launch a deterministic Mind supervisor for a given mind.
 *
 * The supervisor handles all control flow: spawning drones, waiting for
 * completion, running deterministic checks, calling the LLM for review,
 * handling retries, and publishing MIND_COMPLETE when done.
 *
 * Returns a promise that resolves when the supervisor is done AND a
 * MindInfo object with the initial tracking information. The supervisor
 * publishes MIND_COMPLETE via the bus, so waitForWaveCompletion() picks
 * it up as before.
 */
function launchMindSupervisor(
  repoRoot: string,
  mindsSourceDir: string,
  mindName: string,
  ticketId: string,
  waveId: string,
  busUrl: string,
  busPort: number,
  channel: string,
  tasks: import("../lib/implement-types.ts").MindTask[],
  featureDir: string,
  dependencies: string[],
  callerPane: string,
  baseBranch: string,
): { info: MindInfo; done: Promise<void> } {
  const supervisorConfig: SupervisorConfig = {
    mindName,
    ticketId,
    waveId,
    tasks,
    repoRoot,
    busUrl,
    busPort,
    channel,
    worktreePath: "(resolved by drone-pane)",
    baseBranch,
    callerPane,
    mindsSourceDir,
    featureDir,
    dependencies,
    maxIterations: 3,
    droneTimeoutMs: 20 * 60 * 1000, // 20 minutes
  };

  // MindInfo placeholder -- will be updated when supervisor provides drone info
  const info: MindInfo = {
    mindName,
    waveId,
    paneId: "(supervisor)", // No Mind pane -- the supervisor IS the mind
    worktree: "(pending)",
    branch: "(pending)",
  };

  const done = runMindSupervisor(supervisorConfig).then((result) => {
    // Update info with actual values from the supervisor result
    info.worktree = result.worktree;
    info.branch = result.branch;
    if (result.dronePaneId) {
      info.paneId = result.dronePaneId;
    }

    if (!result.ok) {
      const errorMsg = result.errors.join("; ");
      console.error(`  Supervisor @${mindName} failed: ${errorMsg}`);
      throw new Error(`Supervisor failed for @${mindName}: ${errorMsg}`);
    }

    if (result.approvedWithWarnings) {
      console.log(
        `  Supervisor @${mindName}: approved with warnings after ${result.iterations} iteration(s)`,
      );
    } else {
      console.log(
        `  Supervisor @${mindName}: approved after ${result.iterations} iteration(s)`,
      );
    }
  });

  return { info, done };
}

/* ------------------------------------------------------------------ */
/*  Merge helper                                                       */
/* ------------------------------------------------------------------ */

function mergeDroneWorktree(
  repoRoot: string,
  drone: MindInfo,
): { ok: boolean; error?: string } {
  const proc = Bun.spawnSync(
    ["git", "-C", repoRoot, "merge", "--no-ff", drone.branch,
     "-m", `merge: @${drone.mindName} (${drone.waveId})`],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode === 0) {
    return { ok: true };
  }
  const stderr = new TextDecoder().decode(proc.stderr);
  return { ok: false, error: stderr || `exit code ${proc.exitCode}` };
}

/* ------------------------------------------------------------------ */
/*  Main orchestrator                                                  */
/* ------------------------------------------------------------------ */

export async function runImplement(
  ticketId: string,
  options: ImplementOptions,
): Promise<void> {
  const repoRoot = getRepoRoot();
  const mindsDir = resolveMindsDir(repoRoot);
  const mindsSourceDir = resolveMindsSourceDir();
  const channel = `minds-${ticketId}`;

  console.log(`\nMinds Implement: ${ticketId}`);
  console.log(`Repo root: ${repoRoot}`);
  console.log(`Minds dir: ${mindsDir}`);

  // ── Step 0: Cleanup orphaned bus states ──────────────────────────────────

  console.log("\nStep 0: Checking for orphaned bus processes...");
  const orphans = await findOrphanedBusStates(repoRoot);
  if (orphans.length > 0) {
    console.log(`  Found ${orphans.length} orphaned bus state(s), cleaning up...`);
    for (const orphan of orphans) {
      await clearBusState(repoRoot, orphan.ticketId);
      console.log(`  Cleaned: minds-${orphan.ticketId}`);
    }
  } else {
    console.log("  No orphaned bus processes found.");
  }

  // ── Step 1: Load Mind registry ────────────────────────────────────────────

  console.log("\nStep 1: Loading Mind registry...");
  const mindsJsonPath = join(mindsDir, "minds.json");
  if (!existsSync(mindsJsonPath)) {
    console.error(`Error: Mind registry not found at ${mindsJsonPath}`);
    console.error("Run 'minds init' first to install the Minds system.");
    process.exit(1);
    return;
  }

  const registry = JSON.parse(readFileSync(mindsJsonPath, "utf-8"));
  const registeredMinds = new Set(
    (registry as Array<{ name: string }>).map((m) => m.name),
  );
  console.log(`  Loaded ${registeredMinds.size} registered minds.`);

  // ── Step 2: Resolve feature directory ──────────────────────────────────────

  console.log("\nStep 2: Resolving feature directory...");
  const featureDir = resolveFeatureDir(repoRoot, ticketId);
  if (!featureDir) {
    console.error(`Error: No feature directory found for ${ticketId} in specs/`);
    process.exit(1);
    return;
  }
  console.log(`  Feature dir: ${featureDir}`);

  // ── Step 3: Parse and group tasks ──────────────────────────────────────────

  console.log("\nStep 3: Parsing tasks.md...");
  const tasksPath = join(featureDir, "tasks.md");
  if (!existsSync(tasksPath)) {
    console.error(`Error: tasks.md not found at ${tasksPath}`);
    process.exit(1);
    return;
  }

  const tasksContent = readFileSync(tasksPath, "utf-8");
  const taskGroups = parseAndGroupTasks(tasksContent);

  if (taskGroups.length === 0) {
    console.log("  No tasks found in tasks.md. Nothing to implement.");
    return;
  }

  const totalTasks = taskGroups.reduce((sum, g) => sum + g.tasks.length, 0);
  console.log(
    `  Found ${totalTasks} tasks across ${taskGroups.length} mind(s).`,
  );

  // Warn about unregistered minds
  for (const group of taskGroups) {
    if (!registeredMinds.has(group.mind)) {
      console.warn(`  Warning: @${group.mind} is not in the Mind registry.`);
    }
  }

  // ── Step 4: Compute execution waves ────────────────────────────────────────

  console.log("\nStep 4: Computing execution waves...");
  let waves;
  try {
    waves = computeWaves(taskGroups);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
    return;
  }
  console.log(`  Computed ${waves.length} wave(s).`);

  // ── Step 5: Display dispatch plan ──────────────────────────────────────────

  console.log("\n--- Dispatch Plan ---");
  console.log(formatWavePlan(waves, taskGroups));
  console.log("--- End Plan ---\n");



  // ── Step 5b: Clean stale state from previous runs ─────────────────────────

  const staleStateFile = join(mindsDir, "state", `minds-bus-${ticketId}.json`);
  if (existsSync(staleStateFile)) {
    unlinkSync(staleStateFile);
    console.log("  Cleared stale bus state from previous run.");
  }
  // Clear old brief files for this ticket
  const stateDir = join(mindsDir, "state");
  if (existsSync(stateDir)) {
    for (const f of readdirSync(stateDir)) {
      if (f.startsWith("brief-") && f.endsWith(".md")) {
        unlinkSync(join(stateDir, f));
      }
    }
  }

  // ── Step 5c: Ensure dashboard is built ────────────────────────────────────

  console.log("\nStep 5c: Ensuring dashboard is built...");
  const dashboardBuild = ensureDashboardBuilt(mindsDir);
  if (dashboardBuild.skipped) {
    console.log("  Dashboard already built (or not present).");
  } else if (dashboardBuild.success) {
    console.log("  Dashboard built successfully.");
  } else {
    console.error(`  Warning: ${dashboardBuild.error} — dashboard may not be available.`);
  }

  // ── Step 6: Start bus server ───────────────────────────────────────────────

  console.log("\nStep 6: Starting bus server...");
  const callerPane = getCurrentPane();
  let busInfo;
  try {
    busInfo = await startMindsBus(repoRoot, callerPane, ticketId);
  } catch (err) {
    console.error(`Error starting bus: ${(err as Error).message}`);
    process.exit(1);
    return;
  }
  console.log(`  Bus URL: ${busInfo.busUrl}`);
  console.log(`  Bus PID: ${busInfo.busServerPid}, Bridge PID: ${busInfo.bridgePid}`);

  // Read dashboard URL
  try {
    const portFile = join(mindsDir, "aggregator-port");
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, "utf-8").trim();
      console.log(`  Dashboard: http://localhost:${port}/minds`);
    }
  } catch {
    // Non-critical
  }

  // ── SIGINT handler ─────────────────────────────────────────────────────────

  const abortController = new AbortController();
  const allDrones: MindInfo[] = [];

  const cleanup = async () => {
    console.log("\nGraceful shutdown...");
    abortController.abort();

    // Kill all Mind panes
    for (const d of allDrones) {
      killPane(d.paneId);
    }

    // Teardown bus
    try {
      await teardownMindsBus({
        busServerPid: busInfo.busServerPid,
        bridgePid: busInfo.bridgePid,
        aggregatorPid: busInfo.aggregatorPid,
        repoRoot,
        ticketId,
      });
    } catch {
      // Best effort
    }

    // Cleanup worktrees
    for (const d of allDrones) {
      cleanupDroneWorktree(d.worktree, repoRoot);
    }

    console.log("Cleanup complete.");
    process.exit(1);
  };

  process.on("SIGINT", cleanup);

  // ── Step 7-8: Execute waves ────────────────────────────────────────────────

  const result: ImplementResult = {
    ok: true,
    wavesCompleted: 0,
    totalWaves: waves.length,
    mindsSpawned: [],
    mergeResults: [],
    errors: [],
  };

  const groupMap = new Map(taskGroups.map((g) => [g.mind, g]));

  for (const wave of waves) {
    console.log(`\n=== Executing ${wave.id}: [${wave.minds.map((m) => `@${m}`).join(", ")}] ===`);

    // Publish WAVE_STARTED
    await publishWaveStarted(busInfo.busUrl, channel, wave.id);

    // Launch deterministic supervisors for this wave
    const waveDrones: MindInfo[] = [];
    const supervisorPromises: Promise<void>[] = [];

    // Extract bus port from URL for supervisor config
    const busPort = parseInt(new URL(busInfo.busUrl).port, 10);
    // Resolve base branch for diff comparisons
    const baseBranch = Bun.spawnSync(["git", "-C", repoRoot, "branch", "--show-current"], {
      stdout: "pipe",
    });
    const baseBranchName = new TextDecoder().decode(baseBranch.stdout).trim() || "dev";

    for (const mindName of wave.minds) {
      const group = groupMap.get(mindName);
      if (!group) {
        console.warn(`  Skipping @${mindName}: no task group found.`);
        continue;
      }

      console.log(`  Launching supervisor for @${mindName}...`);
      try {
        const { info, done } = launchMindSupervisor(
          repoRoot,
          mindsSourceDir,
          mindName,
          ticketId,
          wave.id,
          busInfo.busUrl,
          busPort,
          channel,
          group.tasks,
          featureDir,
          group.dependencies,
          callerPane,
          baseBranchName,
        );
        waveDrones.push(info);
        allDrones.push(info);
        result.mindsSpawned.push(info);
        supervisorPromises.push(done);
        console.log(`  Supervisor launched for @${mindName}`);
      } catch (err) {
        console.error(`  Error launching @${mindName}: ${(err as Error).message}`);
        result.errors.push(`Launch failed for @${mindName}: ${(err as Error).message}`);
        result.ok = false;
      }
    }

    if (waveDrones.length === 0) {
      console.warn(`  No supervisors launched for ${wave.id}. Skipping.`);
      continue;
    }

    // Wait for all supervisors in this wave to complete.
    // The supervisors publish MIND_COMPLETE via the bus, so waitForWaveCompletion
    // will pick those up. We also track the supervisor promises directly as a
    // fallback to detect failures that don't reach the bus.
    console.log(`\n  Waiting for ${waveDrones.length} supervisor(s) to complete ${wave.id}...`);

    const completionResult = await waitForWaveCompletion(
      busInfo.busUrl,
      channel,
      wave.id,
      waveDrones.map((d) => d.mindName),
      30 * 60 * 1000, // 30 min timeout
      abortController.signal,
    );

    if (!completionResult.ok) {
      console.error(`  Wave ${wave.id} did not complete successfully.`);
      for (const err of completionResult.errors) {
        console.error(`    ${err}`);
      }
      if (completionResult.missing.length > 0) {
        console.error(
          `    Missing completions: ${completionResult.missing.map((m) => `@${m}`).join(", ")}`,
        );
      }
      result.ok = false;
      result.errors.push(
        `Wave ${wave.id} incomplete: missing ${completionResult.missing.join(", ")}`,
      );
      break; // Stop executing further waves
    }

    // Publish WAVE_COMPLETE
    await publishWaveComplete(busInfo.busUrl, channel, wave.id);
    result.wavesCompleted++;
    console.log(`  Wave ${wave.id} complete.`);

    // Supervisors handle their own drone pane cleanup.
    // Wait for any supervisor promises that haven't resolved yet (edge case:
    // bus got the MIND_COMPLETE but the supervisor promise is still settling).
    await Promise.allSettled(supervisorPromises);
  }

  // ── Step 9: Merge worktrees ────────────────────────────────────────────────

  if (result.ok) {
    console.log("\n=== Merging Mind worktrees ===");
    for (const drone of allDrones) {
      console.log(`  Merging @${drone.mindName} (${drone.branch})...`);
      const mergeResult = mergeDroneWorktree(repoRoot, drone);
      result.mergeResults.push({
        mind: drone.mindName,
        ok: mergeResult.ok,
        error: mergeResult.error,
      });

      if (mergeResult.ok) {
        console.log(`  Merged @${drone.mindName} successfully.`);
      } else {
        console.error(
          `  Merge failed for @${drone.mindName}: ${mergeResult.error}`,
        );
        result.ok = false;
        result.errors.push(
          `Merge failed for @${drone.mindName}: ${mergeResult.error}`,
        );
      }
    }
  }

  // ── Step 10: Report final status ───────────────────────────────────────────

  console.log("\n=== Implementation Summary ===");
  console.log(`  Waves completed: ${result.wavesCompleted}/${result.totalWaves}`);
  console.log(`  Minds spawned: ${result.mindsSpawned.length}`);
  console.log(
    `  Merges: ${result.mergeResults.filter((r) => r.ok).length}/${result.mergeResults.length} successful`,
  );

  if (result.errors.length > 0) {
    console.error(`  Errors:`);
    for (const err of result.errors) {
      console.error(`    - ${err}`);
    }
  }

  // ── Step 11: Cleanup ───────────────────────────────────────────────────────

  console.log("\nCleaning up...");

  // Teardown bus
  try {
    await teardownMindsBus({
      busServerPid: busInfo.busServerPid,
      bridgePid: busInfo.bridgePid,
      aggregatorPid: busInfo.aggregatorPid,
      repoRoot,
      ticketId,
    });
    console.log("  Bus server stopped.");
  } catch (err) {
    console.warn(`  Warning: Bus teardown error: ${err}`);
  }

  // Remove worktrees
  for (const drone of allDrones) {
    const cleanResult = cleanupDroneWorktree(drone.worktree, repoRoot);
    if (cleanResult.ok) {
      console.log(`  Cleaned worktree: ${drone.worktree}`);
    } else {
      for (const e of cleanResult.errors) {
        console.warn(`  Warning: cleanup error for ${e.path}: ${e.error}`);
      }
    }
  }

  // Remove SIGINT handler
  process.removeListener("SIGINT", cleanup);

  if (!result.ok) {
    console.log("\nImplementation completed with errors.");
    process.exit(1);
  } else {
    console.log("\nImplementation complete. All waves merged successfully.");
  }

  // Explicit exit — open handles (SSE readers, timers) keep the event loop alive
  process.exit(result.ok ? 0 : 1);
}
