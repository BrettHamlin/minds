/**
 * tmux-utils.ts — Shared tmux utilities for Mind/Drone lifecycle management.
 */

/**
 * Kill a tmux pane by ID. Silently ignores errors (pane may already be gone).
 */
export function killPane(paneId: string): void {
  try {
    Bun.spawnSync(["tmux", "kill-pane", "-t", paneId], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // Pane may already be gone
  }
}

/**
 * Launch Claude Code in an existing tmux pane (send-keys approach).
 * Used for re-launching a drone in an existing worktree without creating a new one.
 */
export function launchClaudeInPane(opts: {
  paneId: string;
  worktreePath: string;
  model?: string;
  prompt: string;
  busUrl?: string;
}): void {
  const { paneId, worktreePath, model = "sonnet", prompt, busUrl } = opts;
  const escapedPrompt = JSON.stringify(prompt);
  let cmd = `cd ${worktreePath} && claude --dangerously-skip-permissions --model ${model} ${escapedPrompt}`;
  if (busUrl) {
    cmd = `BUS_URL=${busUrl} ${cmd}`;
  }
  // Use send-keys to execute in the existing pane
  Bun.spawnSync(
    ["tmux", "send-keys", "-t", paneId, cmd, "Enter"],
    { stdout: "ignore", stderr: "ignore" },
  );
}

/**
 * Create a new tmux pane by splitting from a source pane.
 * Returns the new pane ID.
 */
export function splitPane(sourcePane: string): string {
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
