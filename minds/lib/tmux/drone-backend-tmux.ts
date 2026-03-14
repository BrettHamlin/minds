/**
 * drone-backend-tmux.ts — TmuxDroneBackend: DroneBackend implementation using tmux panes.
 *
 * Wraps the existing TmuxMultiplexer (splitPane + sendKeys + killPane + isPaneAlive)
 * and the sentinel file completion mechanism from supervisor-drone.ts into the
 * DroneBackend interface.
 *
 * This is the "legacy" backend that preserves the proven tmux-based drone
 * management path. The AxonDroneBackend is the event-driven alternative.
 */

import { existsSync } from "fs";
import { join } from "path";
import type { DroneBackend, DroneHandle, DroneSpawnOpts, DroneCompletionResult } from "../drone-backend.ts";
import { TmuxMultiplexer } from "../tmux-multiplexer.ts";
import { shellQuote } from "../tmux-utils.ts";
import { SENTINEL_FILENAME } from "../supervisor/supervisor-types.ts";

export class TmuxDroneBackend implements DroneBackend {
  private readonly mux: TmuxMultiplexer;

  constructor(mux?: TmuxMultiplexer) {
    this.mux = mux ?? new TmuxMultiplexer();
  }

  async spawn(opts: DroneSpawnOpts): Promise<DroneHandle> {
    const sourcePane = opts.callerPane ?? "";
    const paneId = await this.mux.splitPane(sourcePane);

    // Build command with env prefix, cd, and the command + args
    const envPrefix = opts.env
      ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`).join(" ") + " "
      : "";
    const argsStr = opts.args.length > 0 ? " " + opts.args.join(" ") : "";
    const cmdString = `cd ${shellQuote(opts.cwd)} && ${envPrefix}${opts.command}${argsStr}`;

    await this.mux.sendKeys(paneId, cmdString);

    return { id: paneId, backend: "tmux" };
  }

  async kill(handle: DroneHandle): Promise<void> {
    try {
      await this.mux.killPane(handle.id);
    } catch {
      // Idempotent: ignore errors if pane is already dead
    }
  }

  async waitForCompletion(
    handle: DroneHandle,
    worktreePath: string,
    timeoutMs: number,
    pollIntervalMs: number = 2000,
  ): Promise<DroneCompletionResult> {
    const sentinelPath = join(worktreePath, SENTINEL_FILENAME);
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      // Check if sentinel file exists
      if (existsSync(sentinelPath)) {
        return this.parseSentinel(sentinelPath);
      }

      // Check if pane is still alive
      const alive = await this.mux.isPaneAlive(handle.id);
      if (!alive) {
        return { ok: false, error: "drone pane exited without sentinel file" };
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    return { ok: false, error: "timeout waiting for drone completion" };
  }

  async isAlive(handle: DroneHandle): Promise<boolean> {
    return this.mux.isPaneAlive(handle.id);
  }

  async captureOutput(handle: DroneHandle): Promise<string> {
    try {
      return await this.mux.capturePane(handle.id);
    } catch {
      return "";
    }
  }

  close(): void {
    this.mux.close?.();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse the sentinel file content. The file is created by a Claude Code
   * Stop hook. It may contain an exit code, or be empty (from `touch`).
   *
   * - Empty content: treated as success (ok: true, no exitCode)
   * - "0": success (ok: true, exitCode: 0)
   * - Non-zero number: failure (ok: false, exitCode: N)
   */
  private async parseSentinel(sentinelPath: string): Promise<DroneCompletionResult> {
    try {
      const content = await Bun.file(sentinelPath).text();
      const trimmed = content.trim();
      if (trimmed === "") {
        return { ok: true };
      }
      const exitCode = parseInt(trimmed, 10);
      if (isNaN(exitCode)) {
        return { ok: true };
      }
      return { ok: exitCode === 0, exitCode };
    } catch {
      // File exists but can't be read — treat as success (sentinel appeared)
      return { ok: true };
    }
  }
}
