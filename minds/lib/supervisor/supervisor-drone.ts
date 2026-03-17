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
 *   1. Write the updated DRONE-BRIEF.md to the existing worktree
 *   2. Dispatch to the appropriate backend (Axon or tmux)
 */
export async function relaunchDroneInWorktree(opts: {
  oldHandle: DroneHandle;
  callerPane: string;
  worktreePath: string;
  briefContent: string;
  busUrl: string;
  mindName: string;
  repoRoot: string;
}): Promise<DroneHandle> {
  const { oldHandle, worktreePath, briefContent } = opts;

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
}): Promise<DroneHandle> {
  const { oldHandle, callerPane, worktreePath, busUrl } = opts;

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
}): Promise<DroneHandle> {
  const { oldHandle, worktreePath, busUrl, mindName, repoRoot } = opts;

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

    const prompt = `Read DRONE-BRIEF.md and REVIEW-FEEDBACK-*.md files. Fix all issues from the review feedback, then complete any remaining tasks. When done, commit and exit cleanly.`;

    // Mirror the exact args from drone-pane.ts Axon spawn path
    await client.spawn(
      newProcessId,
      "claude",
      ["--dangerously-skip-permissions", "--model", "sonnet", "--setting-sources", "project,local", prompt],
      busUrl ? { BUS_URL: busUrl } : null,
      worktreePath,
    );

    return { id: newProcessId, backend: "axon" };
  } finally {
    client.close();
  }
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
 * Subscribe to the Minds bus and wait for a HOOK_Stop event from the drone.
 *
 * Primary completion mechanism for the tmux backend (replaces sentinel file
 * polling). The drone's Claude Code Stop hook publishes HOOK_Stop via
 * send-event.ts. We subscribe via SSE and resolve when that event arrives.
 *
 * Filtering:
 * - type === "HOOK_Stop"
 * - payload.source === "drone:<mindName>" (when mindName is provided)
 * - timestamp >= (now - 60s)  — rejects stale replayed events from previous iterations
 *
 * Safety net: timeout fires if HOOK_Stop never arrives (bus down, crashed drone).
 */
async function waitForDroneCompletionBus(
  mindName: string,
  busUrl: string,
  channel: string,
  timeoutMs: number,
): Promise<{ ok: boolean; error?: string }> {
  // Reject events older than 60s. Handles two cases:
  //   1. Fast drone: completes before we subscribe → buffered event still accepted
  //   2. Stale event from previous iteration → rejected (iterations take > 60s)
  const minTimestampMs = Date.now() - 60_000;

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
        if (mindName && msg.payload?.source !== `drone:${mindName}`) continue;

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

/**
 * Wait for drone completion.
 *
 * Routes based on the drone's backend and available configuration:
 * - **axon**: Uses Axon's native event-based completion detection via
 *   `waitForProcessCompletion()`. No sentinel file needed.
 * - **tmux + bus params**: Subscribes to the Minds bus SSE channel and
 *   waits for a HOOK_Stop event from the drone. Event-driven, no polling.
 * - **tmux (fallback)**: Watches for a sentinel file created by a Claude
 *   Code Stop hook. Event-driven via `fs.watch()` with a poll fallback.
 */
export async function waitForDroneCompletion(
  handle: DroneHandle,
  worktreePath: string,
  timeoutMs: number,
  pollIntervalMs: number = 5000,
  repoRoot?: string,
  busUrl?: string,
  channel?: string,
  mindName?: string,
): Promise<{ ok: boolean; error?: string }> {
  // Axon backend: use native event-based completion detection,
  // but also race against sentinel file detection. Claude Code does not
  // exit after completing work (it waits for the next prompt), so the
  // Axon Exited event may never arrive. The sentinel file is the reliable
  // signal that work is done.
  if (handle.backend === "axon") {
    return waitForDroneCompletionAxon(handle, worktreePath, timeoutMs, repoRoot);
  }

  // tmux backend: bus-based completion (primary path)
  // Subscribe to the Minds bus and wait for HOOK_Stop from this drone.
  if (busUrl && channel) {
    return waitForDroneCompletionBus(mindName ?? "", busUrl, channel, timeoutMs);
  }

  // tmux backend: sentinel file polling (fallback when bus params unavailable)
  const sentinelPath = join(worktreePath, SENTINEL_FILENAME);

  // Backend-aware "is alive" checker
  console.warn(`[waitForDroneCompletion] handle=${JSON.stringify(handle)} repoRoot=${repoRoot} pollInterval=${pollIntervalMs}`);
  const isAlive = await createIsAliveChecker(handle, repoRoot);

  // TOCTOU guard: if the sentinel already exists AND the drone is already gone,
  // the drone completed before we started watching. Return success immediately.
  if (existsSync(sentinelPath)) {
    if (!await isAlive()) {
      // Drone is gone + sentinel exists = completed successfully before we started watching
      return { ok: true };
    }
    // Drone is still alive — sentinel is stale from a previous run, clean it up
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

    // Poll fallback: check sentinel file + drone existence every interval
    const pollTimer = setInterval(async () => {
      // Primary: sentinel file exists
      if (existsSync(sentinelPath)) {
        done({ ok: true });
        return;
      }

      // Fallback: drone no longer alive (crash, manual kill)
      // If sentinel was NOT written but drone is gone, it crashed.
      if (!await isAlive()) {
        done({ ok: false, error: `Drone ${handle.id} (${handle.backend}) died without writing sentinel — likely crashed` });
        return;
      }
    }, pollIntervalMs);

    // Check immediately in case sentinel already exists or drone is already gone
    if (existsSync(sentinelPath)) {
      done({ ok: true });
    }
  });
}

/**
 * Wait for drone completion using Axon's native event-based system.
 *
 * Delegates to `waitForProcessCompletion()` from the Axon completion module,
 * which subscribes to Axon events and resolves when the process exits.
 * This avoids sentinel-file polling entirely when the drone was spawned via Axon.
 */
async function waitForDroneCompletionAxon(
  handle: DroneHandle,
  worktreePath: string,
  timeoutMs: number,
  repoRoot?: string,
): Promise<{ ok: boolean; error?: string }> {
  const sentinelPath = join(worktreePath, SENTINEL_FILENAME);

  // Race two completion signals:
  // 1. Sentinel file detection (reliable -- Claude Code creates this on Stop hook)
  // 2. Axon process exit event (fires if the process actually exits)
  //
  // Claude Code stays running after completing work (waiting for next prompt),
  // so the Axon Exited event may not arrive. The sentinel file is the primary
  // completion signal; Axon exit is a bonus for detecting crashes.

  // Sentinel file watcher -- same approach as tmux backend
  const sentinelPromise = new Promise<{ ok: boolean; error?: string }>((resolve) => {
    // Check immediately in case sentinel already exists
    if (existsSync(sentinelPath)) {
      resolve({ ok: true });
      return;
    }

    // Watch + poll for sentinel
    let done = false;
    const finish = (result: { ok: boolean; error?: string }) => {
      if (done) return;
      done = true;
      clearInterval(pollTimer);
      try { watcher?.close(); } catch { /* ignore */ }
      resolve(result);
    };

    let watcher: ReturnType<typeof watch> | undefined;
    try {
      watcher = watch(worktreePath, (_eventType, filename) => {
        if (filename === SENTINEL_FILENAME && existsSync(sentinelPath)) {
          finish({ ok: true });
        }
      });
      watcher.on("error", () => {
        try { watcher?.close(); } catch { /* ignore */ }
        watcher = undefined;
      });
    } catch {
      // fs.watch() may fail on some platforms -- poll fallback handles it
    }

    // Poll every 5 seconds as fallback
    const pollTimer = setInterval(() => {
      if (existsSync(sentinelPath)) {
        finish({ ok: true });
      }
    }, 5000);
  });

  // Axon exit event watcher
  const axonPromise = (async (): Promise<{ ok: boolean; error?: string }> => {
    const { AxonClient } = await import("../axon/client.ts");
    const { getDaemonPaths } = await import("../axon/daemon-lifecycle.ts");
    const { waitForProcessCompletion } = await import("../axon/completion.ts");

    const resolvedRoot = repoRoot ?? process.cwd();
    const socketPath = process.env.AXON_SOCKET ??
      getDaemonPaths(resolvedRoot).socketPath;

    let client: InstanceType<typeof AxonClient>;
    try {
      client = await AxonClient.connect(socketPath);
    } catch (err) {
      return {
        ok: false,
        error: `Axon connection failed during completion wait: ${err}`,
      };
    }

    try {
      const result = await waitForProcessCompletion(client, handle.id, timeoutMs);
      if (result.error === "timeout") {
        return { ok: false, error: `Drone timed out after ${timeoutMs}ms` };
      }
      if (result.error === "process_not_found") {
        return { ok: false, error: `Drone ${handle.id} not found in Axon — likely crashed` };
      }
      return {
        ok: result.ok,
        error: result.ok ? undefined : `Drone exited with code ${result.exitCode}`,
      };
    } finally {
      client.close();
    }
  })();

  // Timeout
  const timeoutPromise = new Promise<{ ok: boolean; error?: string }>((resolve) => {
    setTimeout(() => {
      resolve({ ok: false, error: `Drone timed out after ${timeoutMs}ms` });
    }, timeoutMs);
  });

  // Race: first to resolve wins (sentinel, axon exit, or timeout)
  return Promise.race([sentinelPromise, axonPromise, timeoutPromise]);
}

/**
 * Create a backend-aware "is alive" checker for a drone.
 *
 * - tmux backend: uses TmuxMultiplexer.isPaneAlive()
 * - axon backend: uses AxonClient.info() to check process state via a
 *   persistent connection (created once, reused across polls)
 */
async function createIsAliveChecker(
  handle: DroneHandle,
  repoRoot?: string,
): Promise<() => Promise<boolean>> {
  if (handle.backend === "tmux") {
    const mux = new TmuxMultiplexer();
    return () => mux.isPaneAlive(handle.id);
  }

  // Axon backend: connect once and reuse
  console.warn(`[createIsAliveChecker] Axon backend — handle=${handle.id} repoRoot=${repoRoot}`);
  const { AxonClient } = await import("../axon/client.ts");
  const { getDaemonPaths } = await import("../axon/daemon-lifecycle.ts");

  // Resolve socket path: explicit env > repoRoot-based > cwd-based
  const resolvedRoot = repoRoot ?? process.cwd();
  const socketPath = process.env.AXON_SOCKET ??
    getDaemonPaths(resolvedRoot).socketPath;
  console.warn(`[createIsAliveChecker] socketPath=${socketPath} (resolvedRoot=${resolvedRoot})`);

  let client: InstanceType<typeof AxonClient> | null = null;
  try {
    client = await AxonClient.connect(socketPath);
    console.warn(`[createIsAliveChecker] Connected to Axon daemon OK`);
  } catch (err) {
    // Can't connect — return a checker that always says "not alive"
    console.warn(`[createIsAliveChecker] CONNECT FAILED: ${err} — will always report not alive`);
    return () => Promise.resolve(false);
  }

  return async () => {
    try {
      const info = await client!.info(handle.id);
      return info.state === "Running" || info.state === "Starting";
    } catch {
      // Process not found or connection lost — drone is gone
      console.warn(`[isAlive] ${handle.id} — Axon info() failed, reporting not alive`);
      return false;
    }
  };
}

