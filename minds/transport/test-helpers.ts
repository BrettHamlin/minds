/**
 * Test helpers for Transport Mind tests.
 *
 * Provides startBusServer/teardownBusServer without importing from
 * orchestrator-init (which is a cross-Mind import and creates a circular dep).
 */

import * as path from "path";
import { spawn } from "child_process";
import * as fs from "fs";

const BUS_SERVER_PATH = path.join(import.meta.dir, "bus-server.ts");
const BUS_STARTUP_TIMEOUT_MS = 5000;

/**
 * Starts bus-server.ts as a detached background process.
 * Resolves with { pid, url } once BUS_READY is printed to stdout.
 */
export function startBusServer(_repoRoot: string): Promise<{ pid: number; url: string }> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(BUS_SERVER_PATH)) {
      reject(new Error(`Bus server not found: ${BUS_SERVER_PATH}`));
      return;
    }

    const proc = spawn("bun", [BUS_SERVER_PATH], {
      stdio: ["ignore", "pipe", "inherit"],
      detached: true,
    });

    proc.unref();

    const timeout = setTimeout(() => {
      try { process.kill(proc.pid!, "SIGTERM"); } catch { /* ignore */ }
      reject(new Error("Bus server startup timeout"));
    }, BUS_STARTUP_TIMEOUT_MS);

    proc.stdout!.on("data", (data: Buffer) => {
      const match = data.toString().match(/BUS_READY port=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ pid: proc.pid!, url: `http://localhost:${parseInt(match[1], 10)}` });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Bus server spawn error: ${err.message}`));
    });

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Bus server exited unexpectedly (code ${code})`));
    });
  });
}

/**
 * Kills the bus server process.
 */
export function teardownBusServer(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already dead — ignore
  }
}
