/**
 * tmux-multiplexer.ts -- Tmux implementation of the TerminalMultiplexer interface.
 *
 * Consolidates all raw tmux calls (Bun.spawnSync, execSync) that were previously
 * scattered across tmux-utils.ts, supervisor-drone.ts, drone-pane.ts, mind-pane.ts,
 * implement.ts, and tmux-send.ts into a single, testable implementation.
 */

import type { TerminalMultiplexer } from "./terminal-multiplexer.ts";

/**
 * Thrown when splitPane() is called but the session already has the maximum
 * number of panes. Callers can catch this specifically to distinguish
 * "budget exhausted" from "tmux command failed."
 */
export class PaneExhaustedError extends Error {
  readonly currentCount: number;
  readonly maxPanes: number;
  constructor(current: number, max: number) {
    super(`Tmux pane limit reached: ${current} panes exist, max is ${max}`);
    this.name = "PaneExhaustedError";
    this.currentCount = current;
    this.maxPanes = max;
  }
}

export const DEFAULT_MAX_PANES = 16;

export class TmuxMultiplexer implements TerminalMultiplexer {
  private readonly maxPanes: number;

  constructor(opts?: { maxPanes?: number }) {
    const envRaw = process.env.MINDS_MAX_TMUX_PANES;
    const envParsed = envRaw ? parseInt(envRaw, 10) : undefined;
    const envMax = envParsed !== undefined && Number.isFinite(envParsed) && envParsed >= 1
      ? envParsed
      : undefined;
    const resolvedMax = opts?.maxPanes ?? envMax ?? DEFAULT_MAX_PANES;
    this.maxPanes = Number.isFinite(resolvedMax) && resolvedMax >= 1
      ? resolvedMax
      : DEFAULT_MAX_PANES;
  }

  /**
   * Count all panes in the tmux session that owns the given pane.
   * Uses `tmux list-panes -s` which counts across ALL windows in the session.
   *
   * Returns null if the count cannot be determined (tmux not running, invalid
   * pane ID, etc.). A valid tmux session always has at least 1 pane, so a
   * successful count is always >= 1.
   *
   * Protected (not on the interface) so tests can stub it without live tmux.
   */
  protected countSessionPanes(paneId: string): number | null {
    try {
      const result = Bun.spawnSync(
        ["tmux", "list-panes", "-s", "-t", paneId, "-F", "#{pane_id}"],
        { stdout: "pipe", stderr: "pipe" },
      );
      if (result.exitCode !== 0) return null;
      const output = new TextDecoder().decode(result.stdout).trim();
      if (!output) return null;
      return output.split("\n").length;
    } catch {
      return null;
    }
  }

  /**
   * Create a new tmux pane by splitting horizontally from a source pane.
   * Returns the new pane ID (e.g., "%42").
   *
   * Throws PaneExhaustedError if the session already has maxPanes panes.
   * If the pane count cannot be determined, the split proceeds with a warning
   * (fail-open — avoids blocking the supervisor when tmux is temporarily flaky).
   */
  async splitPane(sourcePane: string): Promise<string> {
    const currentCount = this.countSessionPanes(sourcePane);
    if (currentCount === null) {
      console.warn(
        `[tmux] Could not determine pane count for ${sourcePane} — proceeding without guard`,
      );
    } else if (currentCount >= this.maxPanes) {
      console.error(
        `[tmux] Pane exhaustion guard fired: ${currentCount}/${this.maxPanes} panes in session`,
      );
      throw new PaneExhaustedError(currentCount, this.maxPanes);
    } else {
      console.log(
        `[tmux] Splitting pane from ${sourcePane} (${currentCount}/${this.maxPanes} active)`,
      );
    }

    const result = Bun.spawnSync(
      ["tmux", "split-window", "-h", "-p", "50", "-t", sourcePane, "-P", "-F", "#{pane_id}"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`Failed to split tmux pane from ${sourcePane}: ${stderr}`);
    }
    return new TextDecoder().decode(result.stdout).trim();
  }

  /**
   * Send a command string to a pane, followed by Enter.
   * Equivalent to typing the command and pressing Enter in the pane.
   */
  async sendKeys(paneId: string, command: string): Promise<void> {
    const result = Bun.spawnSync(
      ["tmux", "send-keys", "-t", paneId, command, "Enter"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`Failed to send-keys to pane ${paneId}: ${stderr}`);
    }
  }

  /**
   * Kill a tmux pane. Silently ignores errors (pane may already be gone).
   */
  async killPane(paneId: string): Promise<void> {
    try {
      Bun.spawnSync(["tmux", "kill-pane", "-t", paneId], {
        stdout: "ignore",
        stderr: "ignore",
      });
    } catch {
      // Pane may already be gone
    }
  }

  /**
   * Check if a pane is still alive by attempting to list it.
   * Returns false if the pane doesn't exist, tmux server is dead, or tmux binary is missing.
   */
  async isPaneAlive(paneId: string): Promise<boolean> {
    try {
      const result = Bun.spawnSync(
        ["tmux", "list-panes", "-t", paneId, "-F", "#{pane_pid}"],
        { stdout: "pipe", stderr: "pipe" },
      );
      return result.exitCode === 0;
    } catch {
      // tmux binary missing or server unreachable
      return false;
    }
  }

  /**
   * Get the current pane ID. Prefers $TMUX_PANE env var, falls back to
   * tmux display-message which returns the focused pane.
   */
  async getCurrentPane(): Promise<string> {
    if (process.env.TMUX_PANE) return process.env.TMUX_PANE;
    try {
      const proc = Bun.spawnSync(
        ["tmux", "display-message", "-p", "#{pane_id}"],
        { stdout: "pipe", stderr: "pipe" },
      );
      return new TextDecoder().decode(proc.stdout).trim() || "";
    } catch {
      return "";
    }
  }

  /**
   * Capture the visible content of a pane.
   */
  async capturePane(paneId: string): Promise<string> {
    const result = Bun.spawnSync(
      ["tmux", "capture-pane", "-t", paneId, "-p"],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (result.exitCode !== 0) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`Failed to capture pane ${paneId}: ${stderr}`);
    }
    return new TextDecoder().decode(result.stdout);
  }
}
