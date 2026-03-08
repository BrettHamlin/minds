#!/usr/bin/env bun
/**
 * Commit and merge a drone's worktree branch into a target branch.
 *
 * CLI usage:
 *   bun minds/lib/merge-drone.ts <worktree-path> <target-branch> [--message 'commit msg'] [--log-content 'text'] [--bus-url <url> --channel <channel> --wave-id <id> --mind <name>]
 */

import { mindsPublish } from "../transport/minds-publish.ts";

export interface MergeResult {
  success: boolean;
  commitHash?: string; // merge commit hash if successful
  branch: string; // drone's branch name
  error?: string; // error message if failed
  hasConflicts?: boolean; // true if merge failed due to conflicts
}

// ─── Internal git helper ──────────────────────────────────────────────────────

async function git(
  cwd: string,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], {
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

// ─── Branch name parser ───────────────────────────────────────────────────────

/**
 * Extracts mind name and ticket ID from a branch name.
 * Expected format: {TICKET_ID}-{mind_name} e.g. "BRE-123-pipeline_core"
 */
function extractMindAndTicket(
  branch: string
): { mindName: string; ticketId: string } | null {
  const match = branch.match(/^([A-Z]+-\d+)-(.+)$/);
  if (!match) return null;
  return { ticketId: match[1], mindName: match[2] };
}

// ─── Library export ───────────────────────────────────────────────────────────

/**
 * Commit any uncommitted changes in the drone worktree, then merge the drone's
 * branch into targetBranch in the main repo.
 *
 * Does NOT auto-resolve conflicts — returns hasConflicts: true and aborts the
 * merge so the repo is left in a clean state.
 */
export async function mergeDrone(options: {
  worktreePath: string;
  targetBranch: string;
  commitMessage?: string;
  repoRoot?: string;
  logContent?: string;
  /** Bus server URL for event emission (optional — non-critical). */
  busUrl?: string;
  /** Bus channel (e.g. "minds-BRE-455"). Required when busUrl is set. */
  channel?: string;
  /** Wave identifier shared with other events in the same dispatch wave. */
  waveId?: string;
  /** Mind name emitting these events (e.g. "signals"). */
  mindName?: string;
}): Promise<MergeResult> {
  const { worktreePath, targetBranch, commitMessage, logContent } = options;
  const repoRoot = options.repoRoot ?? process.cwd();

  // Publish DRONE_MERGING at the start of merge logic (non-critical)
  if (options.busUrl && options.channel && options.waveId && options.mindName) {
    mindsPublish(options.busUrl, options.channel, "DRONE_MERGING", {
      waveId: options.waveId,
      mindName: options.mindName,
    }).catch(() => {});
  }

  // b. Get the drone's branch name.
  const branchResult = await git(worktreePath, "branch", "--show-current");
  if (branchResult.exitCode !== 0) {
    return {
      success: false,
      branch: "",
      error: `Failed to get branch name: ${branchResult.stderr}`,
    };
  }
  const droneBranch = branchResult.stdout;
  if (!droneBranch) {
    return {
      success: false,
      branch: "",
      error: "Worktree is in detached HEAD state — cannot determine branch",
    };
  }

  // Parse mind name once — reused for auto-commit message and log writing.
  const parsed = extractMindAndTicket(droneBranch);

  // a. Check for uncommitted changes.
  const statusResult = await git(worktreePath, "status", "--porcelain");
  if (statusResult.exitCode !== 0) {
    return {
      success: false,
      branch: droneBranch,
      error: `Failed to check status: ${statusResult.stderr}`,
    };
  }

  if (statusResult.stdout.length > 0) {
    // Stage everything.
    const addResult = await git(worktreePath, "add", "-A");
    if (addResult.exitCode !== 0) {
      return {
        success: false,
        branch: droneBranch,
        error: `Failed to stage changes: ${addResult.stderr}`,
      };
    }

    // Build commit message.
    let msg = commitMessage;
    if (!msg) {
      msg = parsed
        ? `feat: @${parsed.mindName} drone work for ${parsed.ticketId}`
        : `feat: drone work on ${droneBranch}`;
    }

    const commitResult = await git(worktreePath, "commit", "-m", msg);
    if (commitResult.exitCode !== 0) {
      return {
        success: false,
        branch: droneBranch,
        error: `Failed to commit: ${commitResult.stderr}`,
      };
    }
  }

  // c. Ensure we're on targetBranch in the main repo.
  const checkoutResult = await git(repoRoot, "checkout", targetBranch);
  if (checkoutResult.exitCode !== 0) {
    return {
      success: false,
      branch: droneBranch,
      error: `Failed to checkout ${targetBranch}: ${checkoutResult.stderr}`,
    };
  }

  // Merge with --no-ff to always produce a merge commit.
  const mergeResult = await git(
    repoRoot,
    "merge",
    droneBranch,
    "--no-ff",
    "-m",
    `Merge ${droneBranch} into ${targetBranch}`
  );

  if (mergeResult.exitCode !== 0) {
    const combinedOutput = `${mergeResult.stdout}\n${mergeResult.stderr}`;
    const hasConflicts =
      combinedOutput.includes("CONFLICT") ||
      combinedOutput.toLowerCase().includes("conflict");

    if (hasConflicts) {
      // Abort the merge so the repo is left clean — caller must resolve manually.
      await git(repoRoot, "merge", "--abort");
      return {
        success: false,
        branch: droneBranch,
        hasConflicts: true,
        error: `Merge conflicts detected:\n${combinedOutput.trim()}`,
      };
    }

    return {
      success: false,
      branch: droneBranch,
      error: `Merge failed: ${(mergeResult.stderr || mergeResult.stdout).trim()}`,
    };
  }

  // e. Capture the merge commit hash.
  const hashResult = await git(repoRoot, "rev-parse", "HEAD");

  // Publish DRONE_MERGED after successful merge (non-critical)
  if (options.busUrl && options.channel && options.waveId && options.mindName) {
    mindsPublish(options.busUrl, options.channel, "DRONE_MERGED", {
      waveId: options.waveId,
      mindName: options.mindName,
    }).catch(() => {});
  }

  // f. Write learning entry to daily log if provided.
  if (logContent && parsed) {
    const { appendDailyLog } = await import("../memory/lib/write.js");
    await appendDailyLog(parsed.mindName, logContent);
  }

  return {
    success: true,
    branch: droneBranch,
    commitHash: hashResult.stdout,
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      "Usage: bun merge-drone.ts <worktree-path> <target-branch> [--message 'commit msg'] [--log-content 'text'] [--bus-url <url> --channel <channel> --wave-id <id> --mind <name>]"
    );
    process.exit(1);
  }

  function getFlag(flag: string): string | undefined {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  }

  const worktreePath = args[0];
  const targetBranch = args[1];

  const commitMessage = getFlag("--message");
  const logContent = getFlag("--log-content");
  const busUrl = getFlag("--bus-url");
  const channel = getFlag("--channel");
  const waveId = getFlag("--wave-id");
  const mindName = getFlag("--mind");

  const result = await mergeDrone({
    worktreePath,
    targetBranch,
    commitMessage,
    logContent,
    busUrl,
    channel,
    waveId,
    mindName,
  });

  if (result.success) {
    console.log(
      JSON.stringify({ ok: true, branch: result.branch, commitHash: result.commitHash })
    );
  } else {
    console.error(
      JSON.stringify({
        ok: false,
        branch: result.branch,
        hasConflicts: result.hasConflicts ?? false,
        error: result.error,
      })
    );
    process.exit(1);
  }
}
