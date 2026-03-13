/**
 * run-command.ts — Stage executor for shell command execution with output capture.
 *
 * Used by BUILD_PIPELINE and TEST_PIPELINE stages to run arbitrary shell
 * commands (build scripts, test runners, etc.) with stdout/stderr capture.
 *
 * Configuration:
 *   stage.config.command  — Shell command to execute (string).
 *                           Falls back to ctx.supervisorConfig.testCommand.
 *   stage.config.timeout  — Timeout in ms (number, default 120_000).
 *
 * Stores:
 *   ctx.store.commandOutput — Combined stdout + stderr from the command.
 */

import type { PipelineStage, StageContext, StageResult } from "../pipeline-types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;

export const executeRunCommand = async (
  stage: PipelineStage,
  ctx: StageContext,
): Promise<StageResult> => {
  const command =
    (stage.config?.command as string | undefined) ??
    ctx.supervisorConfig.testCommand;

  if (!command) {
    return {
      ok: false,
      error: "No command configured: set stage.config.command or supervisorConfig.testCommand",
    };
  }

  const timeoutMs =
    (stage.config?.timeout as number | undefined) ?? DEFAULT_TIMEOUT_MS;

  try {
    const proc = Bun.spawn(["bash", "-c", command], {
      cwd: ctx.worktree,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    // Set up timeout
    const timeoutId = setTimeout(() => {
      try { proc.kill(); } catch { /* already dead */ }
    }, timeoutMs);

    // Read stdout and stderr
    const [stdoutBuf, stderrBuf] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    clearTimeout(timeoutId);

    const output = (stdoutBuf + stderrBuf).trim();
    ctx.store.commandOutput = output;

    if (exitCode !== 0) {
      // Check if killed by timeout (exit code 137 = SIGKILL, 143 = SIGTERM)
      const wasTimeout = exitCode === 137 || exitCode === 143;
      const reason = wasTimeout
        ? `Command timed out after ${timeoutMs}ms`
        : `Command failed with exit code ${exitCode}`;

      return {
        ok: false,
        error: `${reason}: ${command}\n${output}`.trim(),
      };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Command execution error: ${msg}`,
    };
  }
};
