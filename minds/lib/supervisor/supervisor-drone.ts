/**
 * supervisor-drone.ts — Drone spawning, re-launching, completion detection,
 * drone brief construction, and Stop hook installation for the deterministic
 * Mind supervisor.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, watch } from "fs";
import { join } from "path";
import { resolveMindsDir } from "../../shared/paths.ts";
import { extractLastJsonLine } from "../../shared/parse-utils.ts";
import { buildDroneBrief } from "../../cli/lib/drone-brief.ts";
import { killPane, splitPane, launchClaudeInPane, shellQuote } from "../tmux-utils.ts";
import { TmuxMultiplexer } from "../tmux-multiplexer.ts";
import { SENTINEL_FILENAME, type SupervisorConfig } from "./supervisor-types.ts";
import type { DroneHandle } from "../drone-backend.ts";

// ---------------------------------------------------------------------------
// Hook entry shape for Claude Code settings.json
// ---------------------------------------------------------------------------

export interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

// ---------------------------------------------------------------------------
// Build Drone Brief
// ---------------------------------------------------------------------------

export function buildSupervisorDroneBrief(config: SupervisorConfig, feedbackFile?: string): string {
  const mindsDir = resolveMindsDir(config.repoRoot);

  const base = buildDroneBrief({
    ticketId: config.ticketId,
    mindName: config.mindName,
    waveId: config.waveId,
    tasks: config.tasks,
    dependencies: config.dependencies,
    featureDir: config.featureDir,
    mindsDir,
    ownsFiles: config.ownsFiles,
    repo: config.repo,
    testCommand: config.testCommand,
    pipelineTemplate: config.pipelineTemplate,
  });

  if (!feedbackFile) {
    return base;
  }

  const feedbackSection = `\n---\n\n## Review Feedback\n\nRead ${feedbackFile} at the worktree root for issues from the previous review. Fix all items and check them off.\n`;
  return base + feedbackSection;
}

// ---------------------------------------------------------------------------
// Drone Spawning (wrapper around drone-pane.ts — first iteration only)
// ---------------------------------------------------------------------------

export interface DroneSpawnResult {
  handle: DroneHandle;
  worktree: string;
  branch: string;
}

export async function spawnDrone(config: SupervisorConfig, briefContent: string): Promise<DroneSpawnResult> {
  const dronePanePath = join(config.mindsSourceDir, "lib", "drone-pane.ts");

  // Write the drone brief to a temp file
  const stateDir = join(resolveMindsDir(config.repoRoot), "state");
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  const briefPath = join(stateDir, `drone-brief-${config.mindName}-${config.waveId}.md`);
  writeFileSync(briefPath, briefContent);

  const args = [
    "bun", dronePanePath,
    "--mind", config.mindName,
    "--ticket", config.ticketId,
    "--pane", config.callerPane,
    "--brief-file", briefPath,
    "--bus-url", config.busUrl,
    "--channel", config.channel,
    "--wave-id", config.waveId,
    "--base", config.baseBranch,
  ];

  // Multi-repo flags — only added when present
  if (config.mindRepoRoot) args.push("--repo-root", config.mindRepoRoot);
  if (config.repo) args.push("--repo-alias", config.repo);
  if (config.installCommand) args.push("--install-cmd", config.installCommand);
  if (config.mindRepoRoot && config.mindRepoRoot !== config.repoRoot) {
    args.push("--orchestrator-root", config.repoRoot);
  }

  const proc = Bun.spawn(args, {
    cwd: config.repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Read stdout and stderr concurrently to prevent deadlock
  const [output, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`drone-pane.ts failed for @${config.mindName}: ${stderr}`);
  }

  let result: { drone_pane: string; worktree: string; branch: string; backend?: string };
  try {
    // drone-pane.ts may emit log lines before the JSON (e.g. tmux pane guard).
    // Extract the last line that looks like JSON.
    const jsonLine = extractLastJsonLine(output);
    if (!jsonLine) throw new Error("no JSON line found");
    result = JSON.parse(jsonLine);
  } catch {
    throw new Error(`drone-pane.ts returned invalid JSON: ${output}`);
  }

  return {
    handle: {
      id: result.drone_pane,
      backend: (result.backend as "axon" | "tmux") ?? "tmux",
    },
    worktree: result.worktree,
    branch: result.branch,
  };
}

// ---------------------------------------------------------------------------
// Drone Re-launch (reuse existing worktree for retry iterations)
// ---------------------------------------------------------------------------

/**
 * Re-launch a drone in an existing worktree. This preserves the drone's
 * previous commits and the feedback file we just wrote.
 *
 * Steps:
 *   1. Kill the old drone pane
 *   2. Create a new tmux pane
 *   3. Write the updated DRONE-BRIEF.md to the existing worktree
 *   4. Launch Claude Code in the new pane pointed at the same worktree
 */
export async function relaunchDroneInWorktree(opts: {
  oldHandle: DroneHandle;
  callerPane: string;
  worktreePath: string;
  briefContent: string;
  busUrl: string;
  mindName: string;
}): Promise<DroneHandle> {
  const { oldHandle, callerPane, worktreePath, briefContent, busUrl, mindName } = opts;

  // Kill the old drone pane
  await killPane(oldHandle.id);

  // Write updated DRONE-BRIEF.md to the SAME worktree
  writeFileSync(join(worktreePath, "DRONE-BRIEF.md"), briefContent);

  // Create a new tmux pane via shared utility
  const newPaneId = await splitPane(callerPane);

  // Launch Claude Code in the new pane, pointing at the existing worktree.
  // If this fails, kill the new pane to prevent leaking orphaned tmux panes.
  const prompt = `Read DRONE-BRIEF.md and REVIEW-FEEDBACK-*.md files. Fix all issues from the review feedback, then complete any remaining tasks. When done, commit and exit cleanly.`;
  try {
    await launchClaudeInPane({
      paneId: newPaneId,
      worktreePath,
      prompt,
      busUrl,
    });
  } catch (err) {
    await killPane(newPaneId);
    throw err;
  }

  return { id: newPaneId, backend: "tmux" };
}

// ---------------------------------------------------------------------------
// Drone Stop Hook Installation
// ---------------------------------------------------------------------------

/**
 * Install a Claude Code Stop hook in the worktree's `.claude/` directory.
 * When Claude Code exits, the hook writes a sentinel file to the worktree root.
 * This is event-driven (no process-tree polling).
 */
export function installDroneStopHook(worktreePath: string): void {
  const claudeDir = join(worktreePath, ".claude");
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  const sentinelPath = join(worktreePath, SENTINEL_FILENAME);

  // Write a local settings.json with a Stop hook that creates the sentinel file
  const sentinelHookEntry = {
    matcher: "",
    hooks: [
      {
        type: "command" as const,
        command: `touch ${shellQuote(sentinelPath)}`,
      },
    ],
  };

  const settingsPath = join(claudeDir, "settings.json");

  // Merge with existing settings if present
  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // Ignore corrupt settings
    }
  }

  // Preserve existing Stop hooks -- append our sentinel hook instead of replacing
  const existingHooks = (existing.hooks as Record<string, unknown[]> | undefined) ?? {};
  const existingStopHooks = Array.isArray(existingHooks.Stop) ? existingHooks.Stop : [];

  // Remove any previous sentinel hook (idempotent -- prevents duplicates on reinstall)
  const filteredStopHooks = existingStopHooks.filter((entry: HookEntry) => {
    if (!entry || !Array.isArray(entry.hooks)) return true;
    return !entry.hooks.some((h) => h.command?.includes(SENTINEL_FILENAME));
  });

  const merged = {
    ...existing,
    hooks: {
      ...existingHooks,
      Stop: [...filteredStopHooks, sentinelHookEntry],
    },
  };

  writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
}

// ---------------------------------------------------------------------------
// Drone Completion Detection
// ---------------------------------------------------------------------------

/**
 * Wait for drone completion by watching for a sentinel file.
 *
 * The sentinel file is created by a Claude Code Stop hook installed in
 * the worktree's `.claude/settings.json`. This is event-driven via
 * `fs.watch()` with a poll fallback every 5 seconds.
 *
 * Falls back to pane-existence check if the sentinel never appears
 * (e.g., hook didn't fire due to crash).
 *
 * NOTE: Drones are always spawned via drone-pane.ts into tmux panes,
 * regardless of the MINDS_MULTIPLEXER setting. Axon completion detection
 * is NOT used here because Axon has no knowledge of tmux-spawned processes.
 * The sentinel-file + tmux pane-alive polling works reliably for all drones.
 */
export async function waitForDroneCompletion(
  handle: DroneHandle,
  worktreePath: string,
  timeoutMs: number,
  pollIntervalMs: number = 5000,
): Promise<{ ok: boolean; error?: string }> {
  // Use the handle's id for pane-alive checks. For now, all backends use
  // sentinel-based completion with TmuxMultiplexer for pane-alive fallback.
  const paneId = handle.id;
  const mux = new TmuxMultiplexer();

  const sentinelPath = join(worktreePath, SENTINEL_FILENAME);

  // TOCTOU guard: if the sentinel already exists AND the pane is already gone,
  // the drone completed before we started watching. Return success immediately.
  if (existsSync(sentinelPath)) {
    if (!await mux.isPaneAlive(paneId)) {
      // Pane is gone + sentinel exists = drone completed successfully before we started watching
      return { ok: true };
    }
    // Pane is still alive — sentinel is stale from a previous run, clean it up
    try { rmSync(sentinelPath, { force: true }); } catch { /* ignore */ }
  }

  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    let resolved = false;
    const done = (result: { ok: boolean; error?: string }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutTimer);
      clearInterval(pollTimer);
      try { watcher?.close(); } catch { /* ignore */ }
      resolve(result);
    };

    // Timeout
    const timeoutTimer = setTimeout(() => {
      done({ ok: false, error: `Drone timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    // fs.watch() on the worktree directory for the sentinel file
    let watcher: ReturnType<typeof watch> | undefined;
    try {
      watcher = watch(worktreePath, (eventType, filename) => {
        if (filename === SENTINEL_FILENAME && existsSync(sentinelPath)) {
          done({ ok: true });
        }
      });
      watcher.on("error", () => {
        // On macOS (kqueue), deleting the watched directory emits an error.
        // Close gracefully and let the poll fallback handle detection.
        try { watcher?.close(); } catch { /* ignore */ }
        watcher = undefined;
      });
    } catch {
      // fs.watch() may fail on some platforms — fall through to poll
    }

    // Poll fallback: check sentinel file + pane existence every interval
    const pollTimer = setInterval(async () => {
      // Primary: sentinel file exists
      if (existsSync(sentinelPath)) {
        done({ ok: true });
        return;
      }

      // Fallback: pane no longer exists (crash, manual kill)
      // If sentinel was NOT written but pane is gone, the drone crashed.
      if (!await mux.isPaneAlive(paneId)) {
        done({ ok: false, error: `Drone pane ${paneId} died without writing sentinel — likely crashed` });
        return;
      }
    }, pollIntervalMs);

    // Check immediately in case sentinel already exists or pane is already gone
    if (existsSync(sentinelPath)) {
      done({ ok: true });
    }
  });
}

