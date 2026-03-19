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
 * 3. Default -> TmuxDroneBackend (Axon requires explicit opt-in)
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
 * 2. MINDS_DRONE_BACKEND env var -> "axon" to opt in, "tmux" (or unset) for default
 * 3. Default -> TmuxDroneBackend
 *
 * Callers should call `backend.close()` when done to release any persistent
 * connections (e.g., AxonClient socket).
 */
export async function createDroneBackend(
  opts: DroneBackendFactoryOptions,
): Promise<DroneBackend> {
  const { repoRoot, forceBackend } = opts;

  // Determine desired backend: forceBackend takes priority over env var
  // Default to tmux — Axon's event-based completion doesn't help for drones
  // (Claude Code stays running after completing work, so sentinel file is
  // the primary completion signal regardless of backend). Use Axon explicitly
  // via MINDS_DRONE_BACKEND=axon when its process management features are needed.
  const envBackend = process.env.MINDS_DRONE_BACKEND?.toLowerCase();
  const desired = forceBackend ?? envBackend ?? "tmux";

  // Immediate tmux path -- no Axon probing needed
  if (desired === "tmux") {
    console.warn("[drone-backend-factory] Selected backend: tmux (explicit)");
    return new TmuxDroneBackend();
  }

  // Unknown explicit value -- warn and fall back to tmux
  if (desired !== "axon" && desired !== "auto") {
    console.warn(
      `[drone-backend-factory] Unknown MINDS_DRONE_BACKEND value "${desired}" — falling back to tmux`,
    );
    console.warn("[drone-backend-factory] Selected backend: tmux (fallback)");
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
    console.warn("[drone-backend-factory] Selected backend: tmux (no Axon binary)");
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

  console.warn(`[drone-backend-factory] Selected backend: axon (${desired === "axon" ? "explicit" : "auto-detected"})`);
  return backend;
}
