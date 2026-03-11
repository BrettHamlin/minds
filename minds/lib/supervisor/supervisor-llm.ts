/**
 * supervisor-llm.ts — LLM review process lifecycle for the deterministic
 * Mind supervisor.
 *
 * Owns the `claude -p` invocation: process spawning, timeout management,
 * and SIGTERM/SIGKILL escalation for clean process cleanup.
 */

import { DEFAULT_REVIEW_TIMEOUT_MS } from "./supervisor-types.ts";

// ---------------------------------------------------------------------------
// LLM Review (claude -p) with timeout and proper process cleanup
// ---------------------------------------------------------------------------

export async function callLlmReviewDefault(
  prompt: string,
  timeoutMs: number = DEFAULT_REVIEW_TIMEOUT_MS,
  opts?: { worktreePath?: string; agentName?: string },
): Promise<string> {
  const args = ["claude", "-p"];
  if (opts?.agentName) {
    args.push("--agent", opts.agentName);
  } else {
    args.push("--model", "sonnet", "--output-format", "text");
  }

  const proc = Bun.spawn(args, {
    stdin: new Blob([prompt]),
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts?.worktreePath,
  });

  // Race the process against a timeout, clearing the timer on completion
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Review timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  let output: string, stderr: string, exitCode: number;
  try {
    [output, stderr, exitCode] = await Promise.race([
      Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]),
      timeoutPromise,
    ]) as [string, string, number];
  } catch (err) {
    // On ANY error (timeout or read failure), ensure the process is killed.
    // First try SIGTERM, then escalate to SIGKILL after a short window.
    try { proc.kill("SIGTERM"); } catch { /* already dead */ }
    // Give the process 2 seconds to die from SIGTERM before escalating
    const killTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
    }, 2000);
    // Wait for the process to actually exit so we don't orphan it
    try { await proc.exited; } catch { /* ignore */ }
    clearTimeout(killTimer);
    throw err;
  } finally {
    clearTimeout(timeoutTimer);
  }

  if (exitCode !== 0) {
    throw new Error(`claude -p failed (exit ${exitCode}): ${stderr}`);
  }

  return output.trim();
}
