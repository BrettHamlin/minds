/**
 * supervisor-drone.ts — Drone spawning, re-launching, completion detection,
 * drone brief construction, and Stop hook installation for the deterministic
 * Mind supervisor.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { resolveMindsDir } from "../../shared/paths.ts";
import { extractLastJsonLine } from "../../shared/parse-utils.ts";
import { buildDroneBrief } from "../../cli/lib/drone-brief.ts";
import { killPane, splitPane, launchClaudeInPane, shellQuote } from "../tmux-utils.ts";
import type { SupervisorConfig } from "./supervisor-types.ts";
import type { DroneHandle } from "../drone-backend.ts";

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
    busUrl: config.busUrl,
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
  if (config.ownsFiles?.length) {
    args.push("--owns-files", config.ownsFiles.join(","));
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
 *   1. Verify worktree still exists (may have been cleaned up by a previous failed run)
 *   2. Write the updated DRONE-BRIEF.md to the existing worktree
 *   3. Dispatch to the appropriate backend (Axon or tmux)
 */
export async function relaunchDroneInWorktree(opts: {
  oldHandle: DroneHandle;
  callerPane: string;
  worktreePath: string;
  briefContent: string;
  busUrl: string;
  mindName: string;
  repoRoot: string;
  channel?: string;
}): Promise<DroneHandle> {
  const { oldHandle, worktreePath, briefContent } = opts;

  // Guard: verify the worktree still exists before attempting relaunch
  if (!existsSync(worktreePath)) {
    throw new Error(`Worktree does not exist: ${worktreePath} — cannot relaunch drone`);
  }

  // Write updated DRONE-BRIEF.md (common to both backends)
  writeFileSync(join(worktreePath, "DRONE-BRIEF.md"), briefContent);

  if (oldHandle.backend === "axon") {
    return relaunchDroneAxon(opts);
  }
  return relaunchDroneTmux(opts);
}

/**
 * Re-launch a drone using the tmux backend.
 * Kills the old pane, creates a new one, and launches Claude Code.
 */
async function relaunchDroneTmux(opts: {
  oldHandle: DroneHandle;
  callerPane: string;
  worktreePath: string;
  busUrl: string;
  channel?: string;
}): Promise<DroneHandle> {
  const { oldHandle, callerPane, worktreePath, busUrl, channel } = opts;

  await killPane(oldHandle.id);
  const newPaneId = await splitPane(callerPane);

  // Rebalance pane layout after drone spawn so panes stay evenly sized
  if (callerPane) {
    try {
      Bun.spawnSync(
        ["tmux", "select-layout", "-t", callerPane, "tiled"],
        { stdout: "ignore", stderr: "ignore" },
      );
    } catch {
      // Best-effort: layout rebalance is nice-to-have, not critical
    }
  }

  const prompt = `Read DRONE-BRIEF.md and REVIEW-FEEDBACK-*.md files. Fix all issues from the review feedback, then complete any remaining tasks. When done, run the completion command at the bottom of DRONE-BRIEF.md.`;
  try {
    // Retry iterations use Opus — if Sonnet couldn't fix it, the problem is hard enough
    // to warrant the upgrade. Most minds pass on iteration 1 with Sonnet.
    await launchClaudeInPane({
      paneId: newPaneId,
      worktreePath,
      model: "opus",
      prompt,
      busUrl,
      channel,
    });
  } catch (err) {
    await killPane(newPaneId);
    throw err;
  }

  return { id: newPaneId, backend: "tmux" };
}

/**
 * Re-launch a drone using the Axon backend.
 * Kills the old process (idempotent), spawns a new one with a unique ID.
 */
async function relaunchDroneAxon(opts: {
  oldHandle: DroneHandle;
  worktreePath: string;
  busUrl: string;
  mindName: string;
  repoRoot: string;
  channel?: string;
}): Promise<DroneHandle> {
  const { oldHandle, worktreePath, busUrl, mindName, repoRoot, channel } = opts;

  const { AxonClient } = await import("../axon/client.ts");
  const { getDaemonPaths } = await import("../axon/daemon-lifecycle.ts");
  const { sanitizeProcessId } = await import("../axon/types.ts");

  const socketPath = process.env.AXON_SOCKET ??
    getDaemonPaths(repoRoot).socketPath;

  const client = await AxonClient.connect(socketPath);

  try {
    // Kill old process (idempotent — may already be dead)
    try {
      await client.kill(oldHandle.id);
    } catch {
      // Process already exited — fine
    }

    // Generate unique process ID for this iteration
    const newProcessId = sanitizeProcessId(
      `drone-${mindName}-relaunch-${Date.now()}`
    );

    const prompt = `Read DRONE-BRIEF.md and REVIEW-FEEDBACK-*.md files. Fix all issues from the review feedback, then complete any remaining tasks. When done, run the completion command at the bottom of DRONE-BRIEF.md.`;

    // Mirror the exact args from drone-pane.ts Axon spawn path
    await client.spawn(
      newProcessId,
      "claude",
      ["--dangerously-skip-permissions", "--model", "opus", "--setting-sources", "project,local", prompt],
      busUrl ? { BUS_URL: busUrl, ...(channel ? { MINDS_CHANNEL: channel } : {}) } : null,
      worktreePath,
    );

    return { id: newProcessId, backend: "axon" };
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------
// Drone Completion Detection (bus-only)
// ---------------------------------------------------------------------------

/**
 * Wait for drone completion by subscribing to the Minds bus SSE channel
 * and waiting for a HOOK_Stop event from the drone.
 *
 * This is the sole completion detection mechanism. The drone's Claude Code
 * Stop hook publishes HOOK_Stop via send-event.ts.
 *
 * Filtering:
 * - type === "HOOK_Stop"
 * - payload.source === "drone:<mindName>" (when mindName is provided)
 * - timestamp >= (now - 60s)  — rejects stale replayed events from previous iterations
 *
 * Safety net: timeout fires if HOOK_Stop never arrives (bus down, crashed drone).
 */
export async function waitForDroneCompletion(
  _handle: DroneHandle,
  _worktreePath: string,
  timeoutMs: number,
  _pollIntervalMs?: number,
  _repoRoot?: string,
  busUrl?: string,
  channel?: string,
  mindName?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!busUrl || !channel) {
    return { ok: false, error: "Bus URL and channel are required for drone completion detection" };
  }

  // Reject events older than 60s. Handles two cases:
  //   1. Fast drone: completes before we subscribe → buffered event still accepted
  //   2. Stale event from previous iteration → rejected (iterations take > 60s)
  const minTimestampMs = Date.now() - 60_000;
  const filterMindName = mindName ?? "";

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(`${busUrl}/subscribe/${encodeURIComponent(channel)}`, {
        signal: abortController.signal,
      });
    } catch (err) {
      if (abortController.signal.aborted) {
        return { ok: false, error: `Drone timed out after ${timeoutMs}ms` };
      }
      return { ok: false, error: `Bus connection failed: ${err}` };
    }

    if (!response.ok || !response.body) {
      return { ok: false, error: `Bus subscription failed: HTTP ${response.status}` };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await reader.read();
      } catch (err) {
        if (abortController.signal.aborted) {
          return { ok: false, error: `Drone timed out after ${timeoutMs}ms` };
        }
        return { ok: false, error: `Bus stream error: ${err}` };
      }

      if (readResult.done) {
        return { ok: false, error: "Bus stream closed before HOOK_Stop received" };
      }

      sseBuffer += decoder.decode(readResult.value, { stream: true });

      // SSE events are separated by double newlines
      const parts = sseBuffer.split("\n\n");
      sseBuffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.trim()) continue;

        const dataMatch = part.match(/^data:\s*(.+)$/m);
        if (!dataMatch) continue;

        let msg: { type?: string; payload?: Record<string, unknown>; timestamp?: number };
        try {
          msg = JSON.parse(dataMatch[1]);
        } catch {
          continue;
        }

        if (msg.type !== "HOOK_Stop") continue;

        // Filter by source when mindName is provided
        if (filterMindName && msg.payload?.source !== `drone:${filterMindName}`) continue;

        // Reject stale replayed events from previous iterations
        if (msg.timestamp !== undefined && msg.timestamp < minTimestampMs) continue;

        reader.cancel().catch(() => {});
        return { ok: true };
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

