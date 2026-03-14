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
import { runMindSupervisor } from "../../lib/supervisor/mind-supervisor.ts";
import type { SupervisorConfig } from "../../lib/supervisor/supervisor-types.ts";
import { waitForWaveCompletion, type WaveCompletionResult } from "../lib/bus-listener.ts";
import { TmuxMultiplexer } from "../../lib/tmux-multiplexer.ts";
import {
  startMindsBus,
  teardownMindsBus,
  findOrphanedBusStates,
  clearBusState,
} from "../../transport/minds-bus-lifecycle.ts";
import { publishWaveStarted, publishWaveComplete } from "../../transport/wave-event.ts";
import { cleanupDroneWorktree, pruneOrphanedWorktrees } from "../../lib/cleanup.ts";
import { resolveMindsDir, getRepoRoot } from "../../shared/paths.js";
import { ensureDashboardBuilt } from "../../shared/build-dashboard.js";
import type {
  ImplementOptions,
  ImplementResult,
  MindInfo,
} from "../lib/implement-types.ts";
import { resolveOwnsAndBoundary } from "../lib/resolve-owns.ts";
import { scaffoldFromTasks } from "../../instantiate/lib/scaffold.ts";
import { loadWorkspace, type ResolvedWorkspace } from "../../shared/workspace-loader.ts";
import { loadMultiRepoRegistries } from "../../shared/registry-loader.ts";
import { parseTasks, lintTasks } from "../../lib/contracts.ts";
import type { MindDescription } from "../../mind.ts";
import type { SupervisorResult } from "../../lib/supervisor/supervisor-types.ts";
import type { ContractAnnotation } from "../../lib/check-contracts-core.ts";
import { verifyCrossRepoContracts, buildCrossRepoChecks } from "../../lib/supervisor/cross-repo-contracts.ts";
import { producesCode } from "../../lib/supervisor/pipeline-templates.ts";

/**
 * Resolve the source minds directory (where scripts live).
 * This is always the `minds/` directory in the gravitas repo.
 */
function resolveMindsSourceDir(): string {
  // This file is at minds/cli/commands/implement.ts
  // Source dir is minds/
  return resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
}

// getRepoRoot imported from shared/paths.ts

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
/*  Git helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve the repo root for a drone. In multi-repo mode, looks up the
 * drone's repo alias in the workspace. Falls back to orchestratorRoot.
 */
function getDroneRepoRoot(
  drone: MindInfo,
  workspace: ResolvedWorkspace,
  fallback: string,
): string {
  if (drone.repo) {
    return workspace.repoPaths.get(drone.repo) ?? fallback;
  }
  return fallback;
}

/**
 * Resolve the base branch for a git repo.
 * Tries: current branch → origin default → "main" → "dev".
 */
function resolveBaseBranch(repoPath: string): string {
  const result = Bun.spawnSync(["git", "-C", repoPath, "branch", "--show-current"], {
    stdout: "pipe", stderr: "pipe",
  });
  const current = new TextDecoder().decode(result.stdout).trim();
  if (current) return current;

  // Detached HEAD — detect the remote default branch
  const symRef = Bun.spawnSync(
    ["git", "-C", repoPath, "symbolic-ref", "refs/remotes/origin/HEAD"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const symRefOut = new TextDecoder().decode(symRef.stdout).trim();
  if (symRef.exitCode === 0 && symRefOut) {
    return symRefOut.replace(/^refs\/remotes\/origin\//, "");
  }

  // Last resort: check if "main" branch exists, otherwise fall back to "dev"
  const mainCheck = Bun.spawnSync(
    ["git", "-C", repoPath, "rev-parse", "--verify", "refs/heads/main"],
    { stdout: "pipe", stderr: "pipe" },
  );
  return mainCheck.exitCode === 0 ? "main" : "dev";
}

/* ------------------------------------------------------------------ */
/*  Terminal multiplexer                                                */
/* ------------------------------------------------------------------ */

const mux = new TmuxMultiplexer();

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
  ownsFiles?: string[],
  requireBoundary?: boolean,
  repo?: string,
  mindRepoRoot?: string,
  testCommand?: string,
  installCommand?: string,
  pipelineTemplate?: string,
): { info: MindInfo; done: Promise<SupervisorResult> } {
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
    ownsFiles,
    requireBoundary,
    repo,
    mindRepoRoot,
    testCommand,
    installCommand,
    pipelineTemplate,
  };

  // MindInfo placeholder -- will be updated when supervisor provides drone info
  const info: MindInfo = {
    mindName,
    waveId,
    paneId: "(supervisor)", // No Mind pane -- the supervisor IS the mind
    worktree: "(pending)",
    branch: "(pending)",
    repo,
    pipelineTemplate,
  };

  const done = runMindSupervisor(supervisorConfig).then((result) => {
    // Update info with actual values from the supervisor result
    info.worktree = result.worktree;
    info.branch = result.branch;
    if (result.droneId) {
      info.paneId = result.droneId;
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

    return result;
  });

  return { info, done };
}

/* ------------------------------------------------------------------ */
/*  Merge helper                                                       */
/* ------------------------------------------------------------------ */

/**
 * Merge a drone's branch into the current branch of a repo.
 * Assumes the correct base branch is already checked out (caller does this per repo group).
 * On failure, aborts the merge to leave the repo in a clean state for subsequent merges.
 */
function mergeDroneWorktree(
  repoRoot: string,
  drone: MindInfo,
): { ok: boolean; error?: string; hasConflicts?: boolean } {
  const proc = Bun.spawnSync(
    ["git", "-C", repoRoot, "merge", "--no-ff", drone.branch,
     "-m", `merge: @${drone.mindName} (${drone.waveId})`],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode === 0) {
    return { ok: true };
  }
  const stdout = new TextDecoder().decode(proc.stdout);
  const stderr = new TextDecoder().decode(proc.stderr);
  const combined = `${stdout}\n${stderr}`;
  const hasConflicts = combined.toLowerCase().includes("conflict");

  // Abort the failed merge so the repo is left clean for subsequent merges
  Bun.spawnSync(["git", "-C", repoRoot, "merge", "--abort"], { stdout: "pipe", stderr: "pipe" });

  return { ok: false, error: stderr || `exit code ${proc.exitCode}`, hasConflicts };
}

/**
 * Checkout a branch in a repo. Called once per repo group before merging drones.
 * mergeDroneWorktree assumes the correct branch is already checked out.
 */
function checkoutBranch(repoRoot: string, branch: string): { ok: boolean; error?: string } {
  const proc = Bun.spawnSync(
    ["git", "-C", repoRoot, "checkout", branch],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode === 0) return { ok: true };
  const stderr = new TextDecoder().decode(proc.stderr);
  return { ok: false, error: stderr || `exit code ${proc.exitCode}` };
}

/**
 * Group drones by their repo alias. Drones without a repo go into "__default__".
 */
export function groupDronesByRepo(drones: MindInfo[]): Map<string, MindInfo[]> {
  const grouped = new Map<string, MindInfo[]>();
  for (const drone of drones) {
    const key = drone.repo ?? "__default__";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(drone);
  }
  return grouped;
}

/**
 * Resolve the base branch for a specific repo in a workspace.
 * Uses the manifest's defaultBranch if available, otherwise falls back to baseBranchName.
 */
export function resolveRepoBaseBranch(
  repoKey: string,
  workspace: ResolvedWorkspace,
  fallbackBranch: string,
): string {
  if (repoKey === "__default__" || !workspace.manifest) return fallbackBranch;
  const repoConfig = workspace.manifest.repos.find(r => r.alias === repoKey);
  return repoConfig?.defaultBranch ?? fallbackBranch;
}

/* ------------------------------------------------------------------ */
/*  Main orchestrator                                                  */
/* ------------------------------------------------------------------ */

export async function runImplement(
  ticketId: string,
  options: ImplementOptions,
): Promise<void> {
  const repoRoot = getRepoRoot();
  const mindsSourceDir = resolveMindsSourceDir();
  const channel = `minds-${ticketId}`;

  // ── Workspace loading (MR-008) ──────────────────────────────────────────
  const workspace = loadWorkspace(repoRoot);
  const orchestratorRoot = workspace.orchestratorRoot;

  // Use orchestratorRoot for bus, specs, registry, dashboard — NOT repoRoot
  const mindsDir = resolveMindsDir(orchestratorRoot);

  console.log(`\nMinds Implement: ${ticketId}`);
  console.log(`Repo root: ${repoRoot}`);
  if (workspace.isMultiRepo) {
    console.log(`Workspace: multi-repo (${workspace.repoPaths.size} repos)`);
    console.log(`Orchestrator: ${orchestratorRoot}`);
    for (const [alias, path] of workspace.repoPaths) {
      console.log(`  ${alias}: ${path}`);
    }
  }
  console.log(`Minds dir: ${mindsDir}`);

  // ── Step 0: Cleanup orphaned bus states ──────────────────────────────────

  console.log("\nStep 0: Checking for orphaned bus processes...");
  const orphans = await findOrphanedBusStates(orchestratorRoot);
  if (orphans.length > 0) {
    console.log(`  Found ${orphans.length} orphaned bus state(s), cleaning up...`);
    for (const orphan of orphans) {
      await clearBusState(orchestratorRoot, orphan.ticketId);
      console.log(`  Cleaned: minds-${orphan.ticketId}`);
    }
  } else {
    console.log("  No orphaned bus processes found.");
  }

  // Prune stale worktree references across all workspace repos (deduplicated)
  const allRepoRoots = [...new Set([orchestratorRoot, ...workspace.repoPaths.values()])];
  pruneOrphanedWorktrees(allRepoRoots);

  // ── Step 1: Load Mind registry (MR-009: multi-repo aware) ────────────────

  console.log("\nStep 1: Loading Mind registry...");
  let registry: MindDescription[];

  if (workspace.isMultiRepo) {
    // Multi-repo: load and merge registries from each repo
    try {
      registry = loadMultiRepoRegistries(workspace.repoPaths);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
      return;
    }
    if (registry.length === 0) {
      console.warn("  Warning: No minds.json found in any repo. All minds will need owns: annotations.");
    }
    console.log(`  Loaded ${registry.length} minds from ${workspace.repoPaths.size} repos.`);
  } else {
    // Single-repo: load from orchestrator's minds.json
    const mindsJsonPath = join(mindsDir, "minds.json");
    if (!existsSync(mindsJsonPath)) {
      console.error(`Error: Mind registry not found at ${mindsJsonPath}`);
      console.error("Run 'minds init' first to install the Minds system.");
      process.exit(1);
      return;
    }
    registry = JSON.parse(readFileSync(mindsJsonPath, "utf-8")) as MindDescription[];
    console.log(`  Loaded ${registry.length} registered minds.`);
  }

  const registeredMinds = new Set(registry.map((m) => m.name));

  // ── Step 2: Resolve feature directory ──────────────────────────────────────

  console.log("\nStep 2: Resolving feature directory...");
  const featureDir = resolveFeatureDir(orchestratorRoot, ticketId);
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

  // ── Step 3a: Lint tasks with workspace awareness (MR-008) ─────────────────

  const lintWorkspace = workspace.isMultiRepo
    ? { repoAliases: [...workspace.repoPaths.keys()] }
    : undefined;
  const parsedTasks = parseTasks(tasksContent);
  const lintResult = lintTasks(parsedTasks, registry, lintWorkspace);
  if (lintResult.errors.length > 0) {
    console.error(`\n  Task lint errors (${lintResult.errors.length}):`);
    for (const err of lintResult.errors) {
      console.error(`    [${err.type}] ${err.task}: ${err.message}`);
    }
    console.error("\n  Fix task errors before implementing.");
    process.exit(1);
    return;
  }
  if (lintResult.warnings.length > 0) {
    for (const warn of lintResult.warnings) {
      console.warn(`  Warning [${warn.type}] ${warn.task}: ${warn.message}`);
    }
  }

  // ── Step 3b: Scaffold unregistered minds with owns: annotations ───────────

  const scaffoldResults = await scaffoldFromTasks(taskGroups, registry);
  const scaffoldedMinds = scaffoldResults.filter((r) => r.registered);
  if (scaffoldedMinds.length > 0) {
    console.log(`\nStep 3b: Scaffolded ${scaffoldedMinds.length} new mind(s):`);
    for (const r of scaffoldedMinds) {
      const mindName = r.mindDir.split("/").pop();
      console.log(`  Scaffolded @${mindName} → ${r.mindDir}`);
    }

    // Reload registry so wave execution picks up the new minds
    if (workspace.isMultiRepo) {
      const updatedRegistry = loadMultiRepoRegistries(workspace.repoPaths);
      registry.length = 0;
      registry.push(...updatedRegistry);
    } else {
      const mindsJsonPath = join(mindsDir, "minds.json");
      const updatedRegistry = JSON.parse(readFileSync(mindsJsonPath, "utf-8"));
      registry.length = 0;
      registry.push(...updatedRegistry);
    }
    registeredMinds.clear();
    for (const m of registry) {
      registeredMinds.add(m.name);
    }
    console.log(`  Registry reloaded: ${registeredMinds.size} registered minds.`);
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
      if ((f.startsWith("brief-") || f.startsWith("drone-brief-")) && f.endsWith(".md")) {
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
  const callerPane = await mux.getCurrentPane();
  let busInfo;
  try {
    busInfo = await startMindsBus(orchestratorRoot, callerPane, ticketId);
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
      await mux.killPane(d.paneId);
    }

    // Teardown bus with timeout to prevent hanging
    try {
      const busTimeout = setTimeout(() => {
        // Force kill bus processes if teardown hangs
        try { process.kill(busInfo.busServerPid); } catch { /* ignore */ }
        if (busInfo.bridgePid) try { process.kill(busInfo.bridgePid); } catch { /* ignore */ }
        if (busInfo.aggregatorPid) try { process.kill(busInfo.aggregatorPid); } catch { /* ignore */ }
      }, 5000);
      await teardownMindsBus({
        busServerPid: busInfo.busServerPid,
        bridgePid: busInfo.bridgePid,
        aggregatorPid: busInfo.aggregatorPid,
        repoRoot: orchestratorRoot,
        ticketId,
      });
      clearTimeout(busTimeout);
    } catch {
      // Best effort
    }

    // Cleanup worktrees — use per-drone repo root when available
    for (const d of allDrones) {
      cleanupDroneWorktree(d.worktree, getDroneRepoRoot(d, workspace, orchestratorRoot));
    }

    console.log("Cleanup complete.");
  };

  const sigintHandler = () => {
    cleanup().finally(() => process.exit(1));
  };
  process.on("SIGINT", sigintHandler);

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

  // Extract bus port from URL for supervisor config
  const busPort = parseInt(new URL(busInfo.busUrl).port, 10);

  // Resolve base branch for the orchestrator repo
  const baseBranchName = resolveBaseBranch(orchestratorRoot);

  for (const wave of waves) {
    console.log(`\n=== Executing ${wave.id}: [${wave.minds.map((m) => `@${m}`).join(", ")}] ===`);

    // Publish WAVE_STARTED
    await publishWaveStarted(busInfo.busUrl, channel, wave.id);

    // Launch deterministic supervisors for this wave.
    // INVARIANT: waveDrones and supervisorPromises are pushed in lockstep — index i
    // in supervisorPromises corresponds to waveDrones[i]. Both are pushed inside
    // the same try block; if launch fails, neither gets an entry.
    const waveDrones: MindInfo[] = [];
    const supervisorPromises: Promise<SupervisorResult>[] = [];

    for (const mindName of wave.minds) {
      const group = groupMap.get(mindName);
      if (!group) {
        console.warn(`  Skipping @${mindName}: no task group found.`);
        continue;
      }

      console.log(`  Launching supervisor for @${mindName}...`);
      try {
        // T011/T012: resolve ownsFiles precedence and requireBoundary flag
        const { ownsFiles: resolvedOwnsFiles, requireBoundary } = resolveOwnsAndBoundary(
          group.ownsFiles,
          registry as Array<{ name: string; owns_files?: string[] }>,
          mindName,
        );

        // MR-010: Per-repo context for multi-repo workspaces
        const mindRepo = group.repo;
        const mindRepoRoot = mindRepo && workspace.isMultiRepo
          ? workspace.repoPaths.get(mindRepo)
          : undefined;

        // Per-repo config (single lookup — used for branch, testCommand, installCommand)
        const repoConfig = mindRepo && workspace.manifest
          ? workspace.manifest.repos.find(r => r.alias === mindRepo)
          : undefined;

        // Per-repo base branch: workspace defaultBranch > detected > orchestrator fallback
        let repoBranchName = baseBranchName;
        if (repoConfig?.defaultBranch) {
          repoBranchName = repoConfig.defaultBranch;
        } else if (mindRepoRoot) {
          repoBranchName = resolveBaseBranch(mindRepoRoot);
        }

        // Look up pipeline_template from registry for this mind
        const registryEntry = registry.find(m => m.name === mindName);
        const mindPipelineTemplate = registryEntry?.pipeline_template;

        const { info, done } = launchMindSupervisor(
          mindRepoRoot ?? repoRoot,  // Use mind's repo root when available
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
          repoBranchName,
          resolvedOwnsFiles,
          requireBoundary,
          mindRepo,
          mindRepoRoot,
          repoConfig?.testCommand,
          repoConfig?.installCommand,
          mindPipelineTemplate,
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
    // will pick those up. We ALSO race against Promise.allSettled(supervisorPromises)
    // so that if the bus is down (publishSignal silently swallows errors),
    // we still exit when all supervisors finish rather than hanging for 30 minutes.
    console.log(`\n  Waiting for ${waveDrones.length} supervisor(s) to complete ${wave.id}...`);

    const waveCompletionPromise = waitForWaveCompletion(
      busInfo.busUrl,
      channel,
      wave.id,
      waveDrones.map((d) => d.mindName),
      30 * 60 * 1000, // 30 min timeout
      abortController.signal,
    );

    // Fallback: if all supervisor promises settle (success or failure),
    // build a completion result from the promise outcomes directly.
    const supervisorFallbackPromise = Promise.allSettled(supervisorPromises).then(
      (settlements): WaveCompletionResult => {
        const completedMinds: string[] = [];
        const failedErrors: string[] = [];

        for (let i = 0; i < settlements.length; i++) {
          const mindName = waveDrones[i]?.mindName ?? `unknown-${i}`;
          const settlement = settlements[i];
          if (settlement.status === "fulfilled") {
            completedMinds.push(mindName);
          } else {
            failedErrors.push(`@${mindName} supervisor error: ${settlement.reason}`);
          }
        }

        const allCompleted = completedMinds.length === waveDrones.length && failedErrors.length === 0;
        const missingMinds = waveDrones
          .map((d) => d.mindName)
          .filter((m) => !completedMinds.includes(m));

        return {
          ok: allCompleted,
          completed: completedMinds,
          missing: missingMinds,
          errors: failedErrors,
        };
      },
    );

    // Race: whichever resolves first wins. If the bus is working,
    // waitForWaveCompletion will resolve first via SSE events. If the bus
    // is down, supervisorFallbackPromise resolves when all supervisors finish.
    const completionResult = await Promise.race([
      waveCompletionPromise,
      supervisorFallbackPromise,
    ]);

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
    const waveSettlements = await Promise.allSettled(supervisorPromises);

    // ── Per-wave merge (grouped by repo) ────────────────────────────────────
    // Merge this wave's branches into main BEFORE the next wave starts.
    // This ensures wave-N+1 worktrees are branched from a main that includes
    // wave-N's changes (preventing merge conflicts at the end).
    // Group by repo to checkout the correct base branch once per repo.
    console.log(`\n  Merging ${wave.id} branches into main...`);
    let waveMergeOk = true;

    // Group drones by repo
    const dronesByRepo = groupDronesByRepo(waveDrones);

    for (const [repoKey, drones] of dronesByRepo) {
      const mergeRepoRoot = repoKey === "__default__"
        ? orchestratorRoot
        : (workspace.repoPaths.get(repoKey) ?? orchestratorRoot);

      // Checkout correct base branch for this repo before merging
      const repoBranch = resolveRepoBaseBranch(repoKey, workspace, baseBranchName);
      const checkoutResult = checkoutBranch(mergeRepoRoot, repoBranch);
      if (!checkoutResult.ok) {
        console.error(`  Failed to checkout ${repoBranch} in ${repoKey}: ${checkoutResult.error}`);
        for (const drone of drones) {
          result.mergeResults.push({ mind: drone.mindName, ok: false, error: `Checkout failed: ${checkoutResult.error}`, repo: drone.repo });
        }
        waveMergeOk = false;
        continue;
      }

      for (const drone of drones) {
        // Skip merge for non-code minds (build/test pipelines don't produce code to merge)
        if (drone.pipelineTemplate && drone.pipelineTemplate !== "code") {
          const regEntry = registry.find(m => m.name === drone.mindName);
          const isNonCode = regEntry ? !producesCode(regEntry) : true;
          if (isNonCode) {
            console.log(`    Skipping merge for @${drone.mindName} (${drone.pipelineTemplate} pipeline — non-code)`);
            result.mergeResults.push({ mind: drone.mindName, ok: true, repo: drone.repo });
            continue;
          }
        }

        if (!drone.branch || drone.branch.startsWith("(") || !drone.worktree || drone.worktree.startsWith("(")) {
          console.warn(`  Skipping @${drone.mindName}: worktree/branch never resolved.`);
          result.mergeResults.push({ mind: drone.mindName, ok: false, error: "Placeholder worktree/branch", repo: drone.repo });
          waveMergeOk = false;
          continue;
        }

        console.log(`    Merging @${drone.mindName} (${drone.branch}) into ${repoKey}...`);
        const mergeResult = mergeDroneWorktree(mergeRepoRoot, drone);
        result.mergeResults.push({ mind: drone.mindName, ok: mergeResult.ok, error: mergeResult.error, repo: drone.repo });

        if (mergeResult.ok) {
          console.log(`    Merged @${drone.mindName} successfully.`);
        } else {
          console.error(`    Merge failed for @${drone.mindName}: ${mergeResult.error}`);
          waveMergeOk = false;
        }
      }
    }

    if (!waveMergeOk) {
      result.ok = false;
      result.errors.push(`Merge failed for one or more minds in ${wave.id}`);
      break; // Don't start next wave if merge failed
    }

    // ── Post-wave cross-repo contract verification (MR-019, MR-020) ──────
    if (workspace.isMultiRepo) {
      const deferredByMind: Array<{ mindName: string; repo?: string; annotations: ContractAnnotation[] }> = [];

      for (let i = 0; i < waveSettlements.length; i++) {
        const s = waveSettlements[i];
        if (s.status === "fulfilled" && s.value.deferredCrossRepoAnnotations?.length) {
          deferredByMind.push({
            mindName: waveDrones[i].mindName,
            repo: waveDrones[i].repo,
            annotations: s.value.deferredCrossRepoAnnotations,
          });
        }
      }

      if (deferredByMind.length > 0) {
        console.log(`\n  Verifying cross-repo contracts...`);
        const checks = buildCrossRepoChecks(deferredByMind);
        const crossRepoResult = verifyCrossRepoContracts(checks, workspace.repoPaths, orchestratorRoot);

        if (!crossRepoResult.pass) {
          console.error(`  Cross-repo contract violations:`);
          for (const v of crossRepoResult.violations) {
            console.error(`    [${v.annotation.taskId}] ${v.reason}`);
          }
          result.ok = false;
          result.errors.push(`Cross-repo contract violations in ${wave.id}`);
          break;
        }

        console.log(`  Cross-repo contracts verified: ${checks.length} check(s) passed.`);
      }
    }
  }

  // ── Step 9: Merge summary ──────────────────────────────────────────────────
  // Per-wave merges already happened above (inside the wave loop).
  // This section just reports the summary.

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
      repoRoot: orchestratorRoot,
      ticketId,
    });
    console.log("  Bus server stopped.");
  } catch (err) {
    console.warn(`  Warning: Bus teardown error: ${err}`);
  }

  // Remove worktrees (skip placeholders that were never resolved)
  for (const drone of allDrones) {
    if (!drone.worktree || drone.worktree.startsWith("(")) {
      continue; // Worktree was never created -- nothing to clean up
    }
    const cleanResult = cleanupDroneWorktree(drone.worktree, getDroneRepoRoot(drone, workspace, orchestratorRoot));
    if (cleanResult.ok) {
      console.log(`  Cleaned worktree: ${drone.worktree}`);
    } else {
      for (const e of cleanResult.errors) {
        console.warn(`  Warning: cleanup error for ${e.path}: ${e.error}`);
      }
    }
  }

  // Remove SIGINT handler
  process.removeListener("SIGINT", sigintHandler);

  if (!result.ok) {
    console.log("\nImplementation completed with errors.");
    process.exit(1);
  } else {
    console.log("\nImplementation complete. All waves merged successfully.");
  }

  // Explicit exit — open handles (SSE readers, timers) keep the event loop alive
  process.exit(result.ok ? 0 : 1);
}
