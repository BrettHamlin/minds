/**
 * tmux-utils.ts -- Shared tmux utilities for Mind/Drone lifecycle management.
 *
 * `shellQuote` is a general-purpose utility (not tmux-specific).
 * `killPane`, `splitPane`, and `launchClaudeInPane` delegate to a
 * TerminalMultiplexer instance for the actual tmux calls. They remain
 * exported for backward compatibility with callers that don't yet
 * receive a multiplexer via dependency injection.
 *
 * The default multiplexer is created via the factory (which may select
 * Axon or tmux). Since factory creation is async, the default is lazily
 * initialized on first use.
 */

import { TmuxMultiplexer } from "./tmux-multiplexer.ts";
import type { TerminalMultiplexer } from "./terminal-multiplexer.ts";
import { createMultiplexer } from "./multiplexer-factory.ts";

/**
 * Lazily initialized default multiplexer. Created via factory on first use.
 * Falls back to TmuxMultiplexer if factory initialization fails.
 */
let _defaultMux: TerminalMultiplexer | null = null;
let _defaultMuxPromise: Promise<TerminalMultiplexer> | null = null;

async function getDefaultMux(): Promise<TerminalMultiplexer> {
  if (_defaultMux) return _defaultMux;
  if (_defaultMuxPromise) return _defaultMuxPromise;

  _defaultMuxPromise = (async () => {
    try {
      _defaultMux = await createMultiplexer({ repoRoot: process.cwd() });
    } catch {
      _defaultMux = new TmuxMultiplexer();
    }
    return _defaultMux;
  })();

  return _defaultMuxPromise;
}

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
 * Backward-compatibility wrapper — delegates to the default multiplexer.
 * New code should accept a TerminalMultiplexer via dependency injection instead.
 */
export async function killPane(paneId: string): Promise<void> {
  const mux = await getDefaultMux();
  await mux.killPane(paneId);
}

/**
 * Launch Claude Code in an existing tmux pane (send-keys approach).
 * Used for re-launching a drone in an existing worktree without creating a new one.
 *
 * Accepts an optional multiplexer for dependency injection; falls back to
 * the default multiplexer (created via factory).
 */
export async function launchClaudeInPane(
  opts: {
    paneId: string;
    worktreePath: string;
    model?: string;
    prompt: string;
    busUrl?: string;
  },
  mux?: TerminalMultiplexer,
): Promise<void> {
  const resolvedMux = mux ?? await getDefaultMux();
  const { paneId, worktreePath, model = "sonnet", prompt, busUrl } = opts;
  const escapedPrompt = JSON.stringify(prompt);
  let cmd = `cd ${shellQuote(worktreePath)} && claude --dangerously-skip-permissions --model ${model} --setting-sources project,local ${escapedPrompt}`;
  if (busUrl) {
    cmd = `BUS_URL=${shellQuote(busUrl)} ${cmd}`;
  }
  await resolvedMux.sendKeys(paneId, cmd);
}

/**
 * Create a new tmux pane by splitting from a source pane.
 * Returns the new pane ID.
 *
 * Backward-compatibility wrapper — delegates to the default multiplexer.
 * New code should accept a TerminalMultiplexer via dependency injection instead.
 */
export async function splitPane(sourcePane: string): Promise<string> {
  const mux = await getDefaultMux();
  return mux.splitPane(sourcePane);
}
