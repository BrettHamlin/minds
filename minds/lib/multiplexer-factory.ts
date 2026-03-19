/**
 * multiplexer-factory.ts -- Factory for creating TerminalMultiplexer instances.
 *
 * Provides intelligent backend selection between Axon (daemon-based process
 * orchestration) and tmux (traditional terminal multiplexer). Supports
 * environment variable overrides for instant rollback in production.
 *
 * Selection order:
 * 1. forceBackend option (programmatic override)
 * 2. MINDS_MULTIPLEXER env var ("tmux" or "axon")
 * 3. Default -> tmux (Axon requires explicit opt-in)
 */

import type { TerminalMultiplexer } from "./terminal-multiplexer.ts";
import { TmuxMultiplexer } from "./tmux-multiplexer.ts";
import { resolveAxonBinary } from "./axon/resolve-binary.ts";
import { startAxonDaemon } from "./axon/daemon-lifecycle.ts";
import { AxonClient } from "./axon/client.ts";
import { AxonMultiplexer } from "./axon/multiplexer.ts";

export interface MultiplexerFactoryOptions {
  repoRoot: string;
  forceBackend?: "axon" | "tmux";
}

/**
 * Create a TerminalMultiplexer with intelligent backend selection.
 *
 * **Guaranteed never to throw.** All internal failures fall back to TmuxMultiplexer.
 * Callers do not need try/catch around this function.
 *
 * Selection order:
 * 1. forceBackend option -> use specified backend
 * 2. MINDS_MULTIPLEXER env var -> "axon" to opt in, "tmux" (or unset) for default
 * 3. Default -> tmux
 *
 * Callers should call `mux.close?.()` when done to release any persistent
 * connections (e.g., AxonClient socket).
 */
export async function createMultiplexer(
  opts: MultiplexerFactoryOptions,
): Promise<TerminalMultiplexer> {
  const { repoRoot, forceBackend } = opts;

  // Determine desired backend: forceBackend takes priority over env var
  // Default to tmux — Axon requires explicit opt-in via MINDS_MULTIPLEXER=axon
  const envBackend = process.env.MINDS_MULTIPLEXER?.toLowerCase();
  const desired = forceBackend ?? envBackend ?? "tmux";

  // Immediate tmux path -- no Axon probing needed
  if (desired === "tmux") {
    return new TmuxMultiplexer();
  }

  // Unknown explicit value -- warn and fall back to tmux
  if (desired !== "axon" && desired !== "auto") {
    console.warn(
      `[multiplexer-factory] Unknown MINDS_MULTIPLEXER value "${desired}" — falling back to tmux`,
    );
    return new TmuxMultiplexer();
  }

  // Axon path (explicit "axon" or "auto" discovery)
  try {
    return await tryCreateAxonMultiplexer(repoRoot, desired);
  } catch (err) {
    console.warn(
      `[multiplexer-factory] Unexpected error — falling back to tmux: ${err}`,
    );
    return new TmuxMultiplexer();
  }
}

/**
 * Attempt to create an AxonMultiplexer. Falls back to TmuxMultiplexer on any failure.
 */
async function tryCreateAxonMultiplexer(
  repoRoot: string,
  desired: string,
): Promise<TerminalMultiplexer> {
  // Step 1: Check if axon binary exists
  const binary = resolveAxonBinary(repoRoot);
  if (!binary) {
    if (desired === "axon") {
      console.warn(
        "[multiplexer-factory] MINDS_MULTIPLEXER=axon but no Axon binary found — falling back to tmux",
      );
    }
    return new TmuxMultiplexer();
  }

  // Step 2: Start daemon (or confirm it's running)
  let socketPath: string;
  try {
    const status = await startAxonDaemon(repoRoot);
    socketPath = status.socketPath;
  } catch (err) {
    console.warn(
      `[multiplexer-factory] Failed to start Axon daemon — falling back to tmux: ${err}`,
    );
    return new TmuxMultiplexer();
  }

  // Step 3: Connect client
  let client: AxonClient;
  try {
    client = await AxonClient.connect(socketPath);
  } catch (err) {
    console.warn(
      `[multiplexer-factory] Failed to connect to Axon daemon — falling back to tmux: ${err}`,
    );
    return new TmuxMultiplexer();
  }

  return new AxonMultiplexer(client);
}
