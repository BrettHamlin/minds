/**
 * tmux-utils.ts -- Shared tmux utilities for Mind/Drone lifecycle management.
 *
 * `shellQuote` is a general-purpose utility (not tmux-specific).
 * `killPane`, `splitPane`, and `launchClaudeInPane` delegate to a
 * TerminalMultiplexer instance for the actual tmux calls. They remain
 * exported for backward compatibility with callers that don't yet
 * receive a multiplexer via dependency injection.
 */

import { TmuxMultiplexer } from "./tmux-multiplexer.ts";
import type { TerminalMultiplexer } from "./terminal-multiplexer.ts";

/** Default multiplexer instance used by the convenience functions below. */
const defaultMux: TerminalMultiplexer = new TmuxMultiplexer();

/**
 * Shell-quote a string for safe interpolation in shell commands sent via tmux send-keys.
 * Uses single-quote wrapping with proper escaping of embedded single quotes.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Kill a tmux pane by ID. Silently ignores errors (pane may already be gone).
 *
 * Backward-compatibility wrapper — delegates to defaultMux.killPane().
 * New code should accept a TerminalMultiplexer via dependency injection instead.
 */
export function killPane(paneId: string): void {
  defaultMux.killPane(paneId);
}

/**
 * Launch Claude Code in an existing tmux pane (send-keys approach).
 * Used for re-launching a drone in an existing worktree without creating a new one.
 *
 * Accepts an optional multiplexer for dependency injection; falls back to
 * the default TmuxMultiplexer.
 */
export function launchClaudeInPane(
  opts: {
    paneId: string;
    worktreePath: string;
    model?: string;
    prompt: string;
    busUrl?: string;
  },
  mux: TerminalMultiplexer = defaultMux,
): void {
  const { paneId, worktreePath, model = "sonnet", prompt, busUrl } = opts;
  const escapedPrompt = JSON.stringify(prompt);
  let cmd = `cd ${shellQuote(worktreePath)} && claude --dangerously-skip-permissions --model ${model} --setting-sources project,local ${escapedPrompt}`;
  if (busUrl) {
    cmd = `BUS_URL=${shellQuote(busUrl)} ${cmd}`;
  }
  mux.sendKeys(paneId, cmd);
}

/**
 * Create a new tmux pane by splitting from a source pane.
 * Returns the new pane ID.
 *
 * Backward-compatibility wrapper — delegates to defaultMux.splitPane().
 * New code should accept a TerminalMultiplexer via dependency injection instead.
 */
export function splitPane(sourcePane: string): string {
  return defaultMux.splitPane(sourcePane);
}
