/**
 * drone-backend-factory.ts -- Factory for creating DroneBackend instances.
 *
 * Provides intelligent backend selection between Axon (daemon-based process
 * orchestration) and tmux (traditional terminal multiplexer) for drone
 * management. Supports environment variable overrides for instant rollback.
 *
 * Selection order:
 * 1. forceBackend option (programmatic override)
 * 2. MINDS_DRONE_BACKEND env var ("tmux" or "axon")
 * 3. Axon binary found + daemon starts successfully -> AxonDroneBackend
 * 4. Fallback -> TmuxDroneBackend with warning
 */

import type { DroneBackend } from "./drone-backend.ts";
import { TmuxDroneBackend } from "./tmux/drone-backend-tmux.ts";
import { AxonDroneBackend } from "./axon/drone-backend-axon.ts";
import { resolveAxonBinary } from "./axon/resolve-binary.ts";
import { startAxonDaemon } from "./axon/daemon-lifecycle.ts";

export interface DroneBackendFactoryOptions {
  repoRoot: string;
  forceBackend?: "axon" | "tmux";
  /** For tmux backend: pane to split from when spawning drones. */
  callerPane?: string;
}

/**
 * Create a DroneBackend with intelligent backend selection.
 *
 * **Guaranteed never to throw.** All internal failures fall back to TmuxDroneBackend.
 * Callers do not need try/catch around this function.
 *
 * Selection order:
 * 1. forceBackend option -> use specified backend
 * 2. MINDS_DRONE_BACKEND env var -> "tmux" for instant rollback, "axon" to force axon
 * 3. Axon binary found + daemon starts -> AxonDroneBackend
 * 4. Fallback -> TmuxDroneBackend with warning
 *
 * Callers should call `backend.close()` when done to release any persistent
 * connections (e.g., AxonClient socket).
 */
export async function createDroneBackend(
  opts: DroneBackendFactoryOptions,
): Promise<DroneBackend> {
  const { repoRoot, forceBackend } = opts;

  // Determine desired backend: forceBackend takes priority over env var
  const envBackend = process.env.MINDS_DRONE_BACKEND?.toLowerCase();
  const desired = forceBackend ?? envBackend ?? "auto";

  // Immediate tmux path -- no Axon probing needed
  if (desired === "tmux") {
    return new TmuxDroneBackend();
  }

  // Unknown explicit value -- warn and fall back to tmux
  if (desired !== "axon" && desired !== "auto") {
    console.warn(
      `[drone-backend-factory] Unknown MINDS_DRONE_BACKEND value "${desired}" — falling back to tmux`,
    );
    return new TmuxDroneBackend();
  }

  // Axon path (explicit "axon" or "auto" discovery)
  try {
    return await tryCreateAxonDroneBackend(repoRoot, desired);
  } catch (err) {
    console.warn(
      `[drone-backend-factory] Unexpected error — falling back to tmux: ${err}`,
    );
    return new TmuxDroneBackend();
  }
}

/**
 * Attempt to create an AxonDroneBackend. Falls back to TmuxDroneBackend on any failure.
 */
async function tryCreateAxonDroneBackend(
  repoRoot: string,
  desired: string,
): Promise<DroneBackend> {
  // Step 1: Check if axon binary exists
  const binary = resolveAxonBinary(repoRoot);
  if (!binary) {
    if (desired === "axon") {
      console.warn(
        "[drone-backend-factory] MINDS_DRONE_BACKEND=axon but no Axon binary found — falling back to tmux",
      );
    }
    return new TmuxDroneBackend();
  }

  // Step 2: Start daemon (or confirm it's running)
  let socketPath: string;
  try {
    const status = await startAxonDaemon(repoRoot);
    socketPath = status.socketPath;
  } catch (err) {
    console.warn(
      `[drone-backend-factory] Failed to start Axon daemon — falling back to tmux: ${err}`,
    );
    return new TmuxDroneBackend();
  }

  // Step 3: Connect via AxonDroneBackend
  let backend: AxonDroneBackend;
  try {
    backend = await AxonDroneBackend.connect(socketPath);
  } catch (err) {
    console.warn(
      `[drone-backend-factory] Failed to connect to Axon daemon — falling back to tmux: ${err}`,
    );
    return new TmuxDroneBackend();
  }

  return backend;
}
