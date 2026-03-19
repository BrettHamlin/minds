/**
 * daemon-lifecycle.ts -- Lifecycle manager for the Axon daemon.
 *
 * Provides standalone functions to start, stop, and check the Axon daemon
 * using repo-root-relative paths for socket and PID files. Integrates with
 * resolveAxonBinary for binary discovery and AxonClient for graceful shutdown.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveAxonBinary } from "./resolve-binary.ts";
import { AxonClient } from "./client.ts";

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  socketPath: string;
}

export interface DaemonPaths {
  runDir: string;
  socketPath: string;
  pidFile: string;
}

/**
 * Compute the standard daemon paths for a given repo root.
 */
export function getDaemonPaths(repoRoot: string): DaemonPaths {
  const runDir = path.join(repoRoot, ".minds", "run");
  return {
    runDir,
    socketPath: path.join(runDir, "axon.sock"),
    pidFile: path.join(runDir, "axon.pid"),
  };
}

/**
 * Ensure the .minds/run directory exists. Returns the run dir path.
 */
export function ensureRunDir(repoRoot: string): string {
  const { runDir } = getDaemonPaths(repoRoot);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

/**
 * Start the Axon daemon if not already running.
 *
 * - Resolves binary via resolveAxonBinary
 * - Socket at `.minds/run/axon.sock`
 * - PID file at `.minds/run/axon.pid`
 * - Spawns detached, polls for socket readiness (up to 5s)
 */
export async function startAxonDaemon(repoRoot: string): Promise<DaemonStatus> {
  const { socketPath, pidFile } = getDaemonPaths(repoRoot);

  // If already running, return current status
  if (await isAxonRunning(repoRoot)) {
    const pid = readPidFile(pidFile);
    return { running: true, pid, socketPath };
  }

  // Resolve the binary
  const binary = resolveAxonBinary(repoRoot);
  if (!binary) {
    throw new Error(
      "Axon binary not found. Install it to .minds/bin/axon, set AXON_BINARY, or add axon to PATH.",
    );
  }

  // Ensure run directory exists
  ensureRunDir(repoRoot);

  // Remove stale socket if it exists
  cleanupFile(socketPath);

  // Spawn the daemon detached
  const child = spawn(binary, ["server", "--socket", socketPath], {
    stdio: "ignore",
    detached: true,
  });

  child.unref();

  const pid = child.pid ?? null;

  // Write PID file
  if (pid !== null) {
    fs.writeFileSync(pidFile, `${pid}\n`);
  }

  // Poll for socket readiness (up to 5 seconds, 100ms intervals)
  const started = await waitForSocket(socketPath, 5000, 100);

  if (!started) {
    // Cleanup on failure
    if (pid !== null) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may have already exited
      }
    }
    cleanupFile(pidFile);
    throw new Error(`Axon daemon did not start within 5000ms`);
  }

  return { running: true, pid, socketPath };
}

/**
 * Stop the Axon daemon gracefully.
 *
 * - Try: connect via AxonClient and send Shutdown command
 * - Fallback: kill PID from pid file
 * - Cleanup: remove socket and pid files
 */
export async function stopAxonDaemon(repoRoot: string): Promise<void> {
  const { socketPath, pidFile } = getDaemonPaths(repoRoot);

  // Try graceful shutdown via AxonClient
  let shutdownSent = false;
  if (fs.existsSync(socketPath)) {
    try {
      const client = await AxonClient.connect(socketPath);
      await client.shutdown();
      client.close();
      shutdownSent = true;
    } catch {
      // Graceful shutdown failed, fall back to kill
    }
  }

  // Fallback: kill by PID
  if (!shutdownSent) {
    const pid = readPidFile(pidFile);
    if (pid !== null) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may not exist (stale PID file)
      }
    }
  }

  // Cleanup files
  cleanupFile(socketPath);
  cleanupFile(pidFile);
}

/**
 * Check if the Axon daemon is running.
 *
 * - Check PID file exists
 * - Verify process is alive (kill -0)
 * - Verify socket file exists
 */
export async function isAxonRunning(repoRoot: string): Promise<boolean> {
  const { socketPath, pidFile } = getDaemonPaths(repoRoot);

  const pid = readPidFile(pidFile);
  if (pid === null) {
    return false;
  }

  // Check if process is alive (signal 0 = existence check)
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  // Verify socket exists
  return fs.existsSync(socketPath);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read a PID from a pid file. Returns null if file doesn't exist or
 * contains invalid data.
 */
function readPidFile(pidFile: string): number | null {
  try {
    const content = fs.readFileSync(pidFile, "utf-8").trim();
    const pid = parseInt(content, 10);
    if (Number.isNaN(pid) || pid <= 0) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

/**
 * Remove a file if it exists, ignoring errors.
 */
function cleanupFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Poll for a Unix socket file to appear and be connectable.
 */
async function waitForSocket(
  socketPath: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(socketPath)) {
      // Try a quick connection test
      const connectable = await testSocketConnection(socketPath);
      if (connectable) return true;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Test if a Unix socket accepts connections.
 */
function testSocketConnection(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require("node:net");
    const socket = net.createConnection(socketPath);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(500);
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
