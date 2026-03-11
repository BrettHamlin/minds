/**
 * tmux-multiplexer.ts -- Tmux implementation of the TerminalMultiplexer interface.
 *
 * Consolidates all raw tmux calls (Bun.spawnSync, execSync) that were previously
 * scattered across tmux-utils.ts, supervisor-drone.ts, drone-pane.ts, mind-pane.ts,
 * implement.ts, and tmux-send.ts into a single, testable implementation.
 */

import type { TerminalMultiplexer } from "./terminal-multiplexer.ts";

export class TmuxMultiplexer implements TerminalMultiplexer {
  /**
   * Create a new tmux pane by splitting horizontally from a source pane.
   * Returns the new pane ID (e.g., "%42").
   */
  splitPane(sourcePane: string): string {
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
  sendKeys(paneId: string, command: string): void {
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
  killPane(paneId: string): void {
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
   */
  isPaneAlive(paneId: string): boolean {
    const result = Bun.spawnSync(
      ["tmux", "list-panes", "-t", paneId, "-F", "#{pane_pid}"],
      { stdout: "pipe", stderr: "pipe" },
    );
    return result.exitCode === 0;
  }

  /**
   * Get the current pane ID. Prefers $TMUX_PANE env var, falls back to
   * tmux display-message which returns the focused pane.
   */
  getCurrentPane(): string {
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
  capturePane(paneId: string): string {
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
