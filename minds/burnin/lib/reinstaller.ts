/**
 * reinstaller.ts — Handles cleanup -> reinstall -> relaunch cycle on the target repo.
 */

import { join } from "path";
import {
  exitClaudeCode,
  launchClaudeCode,
} from "./target-session.ts";

// ── Helpers ────────────────────────────────────────────────────────────

async function runShell(
  cmd: string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts?.cwd,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// ── Main ───────────────────────────────────────────────────────────────

export interface ReinstallOptions {
  paneId: string;
  targetRepoPath: string;
  gravitasPath: string;
  ticketId: string;
  failedPhase: "tasks" | "implement";
}

export async function reinstallTarget(
  opts: ReinstallOptions,
): Promise<{ ok: boolean; error?: string }> {
  const { paneId, targetRepoPath, gravitasPath, ticketId, failedPhase } = opts;

  try {
    // 1. Exit Claude Code in target pane
    await exitClaudeCode(paneId, gravitasPath);

    // 2. Phase-specific cleanup
    if (failedPhase === "implement") {
      await cleanupImplement(targetRepoPath, gravitasPath, ticketId);
    } else {
      await cleanupTasks(targetRepoPath, ticketId);
    }

    // 3. Reinstall minds
    const initScript = join(gravitasPath, "minds", "cli", "bin", "minds.ts");
    const initResult = await runShell(
      ["bun", initScript, "init", "--force", "--quiet"],
      { cwd: targetRepoPath },
    );
    if (initResult.exitCode !== 0) {
      return { ok: false, error: `minds init failed: ${initResult.stderr}` };
    }

    // 4. Commit reinstalled changes
    await runShell(["git", "add", "-A"], { cwd: targetRepoPath });
    const commitResult = await runShell(
      ["git", "commit", "-m", `burnin: reinstall minds after ${failedPhase} failure for ${ticketId}`, "--allow-empty"],
      { cwd: targetRepoPath },
    );
    if (commitResult.exitCode !== 0 && !commitResult.stderr.includes("nothing to commit")) {
      return { ok: false, error: `commit failed: ${commitResult.stderr}` };
    }

    // 5. Relaunch Claude Code
    await launchClaudeCode(paneId, targetRepoPath, gravitasPath);

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Phase-Specific Cleanup ─────────────────────────────────────────────

async function cleanupImplement(
  targetRepoPath: string,
  gravitasPath: string,
  ticketId: string,
): Promise<void> {
  // List and remove drone worktrees
  const { stdout: worktreeList } = await runShell(
    ["git", "worktree", "list", "--porcelain"],
    { cwd: targetRepoPath },
  );

  const worktreePaths = worktreeList
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.replace("worktree ", ""))
    .filter((path) => path.includes("collab-worktrees") || path.includes("collab-dev"));

  // Use cleanup.ts for each worktree
  const cleanupScript = join(gravitasPath, "minds", "lib", "cleanup.ts");
  for (const wt of worktreePaths) {
    await runShell(["bun", cleanupScript, "worktree", wt, targetRepoPath]);
  }

  // Prune orphaned worktrees
  await runShell(["bun", cleanupScript, "orphans", "--repo-root", targetRepoPath]);

  // Remove drone branches for this ticket
  const { stdout: branchList } = await runShell(
    ["git", "branch", "--list", `minds/${ticketId}-*`],
    { cwd: targetRepoPath },
  );
  const branches = branchList
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean);
  for (const branch of branches) {
    await runShell(["git", "branch", "-D", branch], { cwd: targetRepoPath });
  }

  // Reset to dev branch and clean
  await runShell(["git", "checkout", "dev"], { cwd: targetRepoPath });
  await runShell(["git", "clean", "-fd"], { cwd: targetRepoPath });
}

async function cleanupTasks(
  targetRepoPath: string,
  ticketId: string,
): Promise<void> {
  // Remove the generated tasks.md
  const tasksPath = join(targetRepoPath, "specs", ticketId, "tasks.md");
  await runShell(["rm", "-f", tasksPath]);
}
