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
 *   5. Display dispatch plan, prompt for confirmation (unless --yes)
 *   6. Start bus server
 *   7. For each wave, dispatch drones and wait for completion
 *   8. Between waves: kill drone panes (keep worktrees for merge)
 *   9. After all waves: merge each drone's worktree
 *  10. Report final status
 *  11. Cleanup: teardown bus, remove worktrees
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { join, resolve, dirname } from "path";
import { parseAndGroupTasks } from "../lib/task-parser.ts";
import { computeWaves, formatWavePlan } from "../lib/wave-planner.ts";
import { buildDroneBrief } from "../lib/drone-brief.ts";
import { buildMindBrief } from "../lib/mind-brief.ts";
import { waitForWaveCompletion } from "../lib/bus-listener.ts";
import { promptConfirmation } from "../lib/prompt.ts";
import {
  startMindsBus,
  teardownMindsBus,
  findOrphanedBusStates,
  clearBusState,
} from "../../transport/minds-bus-lifecycle.ts";
import { publishWaveStarted, publishWaveComplete } from "../../transport/wave-event.ts";
import { cleanupDroneWorktree } from "../../lib/cleanup.ts";
import { resolveMindsDir } from "../../shared/paths.js";
import type {
  ImplementOptions,
  ImplementResult,
  DispatchPlan,
  DroneInfo,
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

async function spawnMind(
  repoRoot: string,
  mindsSourceDir: string,
  mindName: string,
  ticketId: string,
  waveId: string,
  busUrl: string,
  channel: string,
  briefContent: string,
  callerPane: string,
): Promise<MindInfo> {
  // Write brief to temp file
  const stateDir = join(resolveMindsDir(repoRoot), "state");
  const briefPath = join(stateDir, `brief-${mindName}-${waveId}.md`);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  writeFileSync(briefPath, briefContent);

  // Spawn Mind via mind-pane.ts
  const mindPanePath = join(mindsSourceDir, "lib", "mind-pane.ts");
  const args = [
    "bun", mindPanePath,
    "--mind", mindName,
    "--ticket", ticketId,
    "--pane", callerPane,
    "--brief-file", briefPath,
    "--bus-url", busUrl,
    "--channel", channel,
    "--wave-id", waveId,
  ];

  const proc = Bun.spawn(args, {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`mind-pane.ts failed for @${mindName}: ${stderr}`);
  }

  let result: { mind_pane: string; worktree: string; branch: string };
  try {
    result = JSON.parse(output.trim());
  } catch {
    throw new Error(`mind-pane.ts returned invalid JSON for @${mindName}: ${output}`);
  }

  return {
    mindName,
    waveId,
    paneId: result.mind_pane,
    worktree: result.worktree,
    branch: result.branch,
  };
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

  if (!options.yes) {
    const confirmed = await promptConfirmation(
      `Dispatch ${totalTasks} tasks across ${waves.length} wave(s)? [y/N] `,
    );
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

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

    // Spawn Minds for this wave
    const waveDrones: MindInfo[] = [];

    for (const mindName of wave.minds) {
      const group = groupMap.get(mindName);
      if (!group) {
        console.warn(`  Skipping @${mindName}: no task group found.`);
        continue;
      }

      const briefContent = buildMindBrief({
        ticketId,
        mindName,
        waveId: wave.id,
        featureDir,
        tasks: group.tasks,
        dependencies: group.dependencies,
        worktreePath: "(resolved at launch)",
      });

      console.log(`  Spawning Mind for @${mindName}...`);
      try {
        const drone = await spawnMind(
          repoRoot,
          mindsSourceDir,
          mindName,
          ticketId,
          wave.id,
          busInfo.busUrl,
          channel,
          briefContent,
          callerPane,
        );
        waveDrones.push(drone);
        allDrones.push(drone);
        result.mindsSpawned.push(drone);
        console.log(`  Spawned @${mindName} in pane ${drone.paneId} (worktree: ${drone.worktree})`);
        // Rebalance pane layout after each spawn so panes stay evenly sized
        Bun.spawnSync(
          ["tmux", "select-layout", "-t", callerPane, "tiled"],
          { stdout: "ignore", stderr: "ignore" },
        );
      } catch (err) {
        console.error(`  Error spawning @${mindName}: ${(err as Error).message}`);
        result.errors.push(`Spawn failed for @${mindName}: ${(err as Error).message}`);
        result.ok = false;
      }
    }

    if (waveDrones.length === 0) {
      console.warn(`  No Minds spawned for ${wave.id}. Skipping.`);
      continue;
    }

    // Wait for all Minds in this wave to complete
    console.log(`\n  Waiting for ${waveDrones.length} Mind(s) to complete ${wave.id}...`);
    // Build a map of mind name → pane ID for per-Mind cleanup
    const mindPaneMap = new Map(waveDrones.map((d) => [d.mindName, d.paneId]));

    const completionResult = await waitForWaveCompletion(
      busInfo.busUrl,
      channel,
      wave.id,
      waveDrones.map((d) => d.mindName),
      30 * 60 * 1000, // 30 min timeout
      abortController.signal,
      (mindName) => {
        // Kill pane immediately when Mind completes
        const paneId = mindPaneMap.get(mindName);
        if (paneId) killPane(paneId);
      },
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

    // Panes are killed individually via onMindComplete callback above.
    // Any stragglers (e.g. from timeout) get cleaned up here.
    for (const d of waveDrones) {
      if (!completionResult.completed.includes(d.mindName)) {
        killPane(d.paneId);
      }
    }
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
}
