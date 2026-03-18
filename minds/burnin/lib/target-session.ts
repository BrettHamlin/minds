/**
 * target-session.ts — Manages the Claude Code session in the target repo's tmux window.
 */

import { join } from "path";

// ── Helpers ────────────────────────────────────────────────────────────

async function runTmuxCli(
  gravitasRoot: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tmuxScript = join(gravitasRoot, "minds", "execution", "Tmux.ts");
  const proc = Bun.spawn(["bun", tmuxScript, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function runShell(
  cmd: string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts?.cwd,
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), exitCode };
}

// ── Window Management ──────────────────────────────────────────────────

/**
 * Create a new tmux window for burn-in testing.
 * Returns the pane ID (e.g., %42).
 */
export async function createTargetWindow(
  windowName: string,
  repoPath: string,
): Promise<string> {
  const result = await runShell([
    "tmux", "new-window", "-d", "-n", windowName, "-P", "-F", "#{pane_id}", "-c", repoPath,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create tmux window '${windowName}'`);
  }
  return result.stdout;
}

/**
 * Launch Claude Code in a tmux pane. Polls until ready.
 */
export async function launchClaudeCode(
  paneId: string,
  repoPath: string,
  gravitasRoot: string,
): Promise<void> {
  // Send the launch command
  await runTmuxCli(gravitasRoot, [
    "send", "--window", paneId,
    "--text", `cd ${repoPath} && claude --dangerously-skip-permissions`,
  ]);

  // Poll for Claude Code ready prompt (up to 30s)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { stdout } = await runTmuxCli(gravitasRoot, [
      "capture", "--window", paneId, "--scrollback", "50",
    ]);
    // Claude Code shows a prompt with > or the project name
    if (/>\s*$/.test(stdout) || /claude/i.test(stdout)) {
      return;
    }
    await Bun.sleep(2000);
  }
  // Proceed even if we didn't detect the prompt — it may just be styled differently
}

/**
 * Send a command/text to a Claude Code session in a tmux pane.
 */
export async function sendCommand(
  paneId: string,
  command: string,
  gravitasRoot: string,
  delaySeconds: number = 1,
): Promise<void> {
  await runTmuxCli(gravitasRoot, [
    "send", "--window", paneId,
    "--text", command,
    "--delay", String(delaySeconds),
  ]);
}

/**
 * Exit Claude Code in a pane: Escape → /exit.
 */
export async function exitClaudeCode(
  paneId: string,
  gravitasRoot: string,
): Promise<void> {
  // Send Escape first to cancel any pending input
  await runShell(["tmux", "send-keys", "-t", paneId, "Escape"]);
  await Bun.sleep(1000);

  // Send /exit
  await runTmuxCli(gravitasRoot, [
    "send", "--window", paneId, "--text", "/exit",
  ]);

  // Poll for shell prompt (up to 15s)
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { stdout } = await runTmuxCli(gravitasRoot, [
      "capture", "--window", paneId, "--scrollback", "20",
    ]);
    // Shell prompt: ends with $ or % or #
    if (/[$%#]\s*$/.test(stdout)) return;
    await Bun.sleep(1000);
  }
}

/**
 * Kill a tmux window/pane.
 */
export async function killTargetWindow(paneId: string): Promise<void> {
  await runShell(["tmux", "kill-pane", "-t", paneId]);
}

/**
 * List all panes in the same window as paneId.
 * Returns array of { paneId, title }.
 */
export async function listPanesInWindow(
  paneId: string,
): Promise<Array<{ paneId: string; title: string }>> {
  // Get the window ID from the pane
  const { stdout: windowId, exitCode } = await runShell([
    "tmux", "display-message", "-t", paneId, "-p", "#{window_id}",
  ]);
  if (exitCode !== 0) return [];

  const { stdout: paneList } = await runShell([
    "tmux", "list-panes", "-t", windowId, "-F", "#{pane_id}\t#{pane_title}",
  ]);
  if (!paneList) return [];

  return paneList
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [id, title] = line.split("\t");
      return { paneId: id, title: title || "" };
    });
}

/**
 * Capture output from all panes in the same window.
 * Returns a map of paneId → captured text.
 */
export async function captureAllPanes(
  paneId: string,
  gravitasRoot: string,
  scrollback: number = 500,
): Promise<Record<string, string>> {
  const panes = await listPanesInWindow(paneId);
  const outputs: Record<string, string> = {};

  for (const pane of panes) {
    const { stdout } = await runTmuxCli(gravitasRoot, [
      "capture", "--window", pane.paneId, "--scrollback", String(scrollback),
    ]);
    outputs[pane.paneId] = stdout;
  }
  return outputs;
}
