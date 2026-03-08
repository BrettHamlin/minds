import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mergeDrone } from "./merge-drone";
import { dailyLogPath } from "../memory/lib/paths.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TMP = join(tmpdir(), "merge-drone-tests");

function tmpPath(name: string): string {
  return join(TMP, name);
}

async function runGit(
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

/**
 * Initialise a git repo with one commit on a given branch.
 * Configures user identity so commits work without global config.
 */
async function initRepo(
  repoPath: string,
  branch = "minds/main"
): Promise<void> {
  mkdirSync(repoPath, { recursive: true });
  await runGit(repoPath, "init", "-b", branch);
  await runGit(repoPath, "config", "user.email", "test@test.com");
  await runGit(repoPath, "config", "user.name", "Test");
  writeFileSync(join(repoPath, "README.md"), "# Test repo\n");
  await runGit(repoPath, "add", "-A");
  await runGit(repoPath, "commit", "-m", "init");
}

/**
 * Add a linked worktree on a new branch derived from the current HEAD.
 */
async function addWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string
): Promise<void> {
  await runGit(repoPath, "worktree", "add", "-b", branchName, worktreePath);
}

afterEach(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("mergeDrone", () => {
  it("commits uncommitted changes in the worktree before merging", async () => {
    const repoPath = tmpPath("repo-uncommitted");
    const worktreePath = tmpPath("wt-uncommitted");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-100-pipeline_core");

    // Add a file to the worktree without committing.
    writeFileSync(join(worktreePath, "new-file.ts"), "export const x = 1;\n");

    const result = await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
    });

    expect(result.success).toBe(true);
    expect(result.branch).toBe("BRE-100-pipeline_core");
    expect(result.commitHash).toBeTruthy();

    // Verify the file landed on minds/main.
    const logResult = await runGit(repoPath, "log", "--oneline", "-3");
    expect(logResult.stdout).toContain("pipeline_core");
  });

  it("merges an already-committed worktree without creating a spurious commit", async () => {
    const repoPath = tmpPath("repo-committed");
    const worktreePath = tmpPath("wt-committed");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-101-signals");

    // Commit a file in the worktree.
    writeFileSync(join(worktreePath, "signal.ts"), "export const s = 2;\n");
    await runGit(worktreePath, "add", "-A");
    await runGit(worktreePath, "commit", "-m", "feat: add signal");

    // Record the drone branch's commit count before merge.
    const droneLogBefore = await runGit(
      repoPath,
      "log",
      "BRE-101-signals",
      "--oneline"
    );
    const droneCommitsBefore = droneLogBefore.stdout.split("\n").length;

    const result = await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
    });

    expect(result.success).toBe(true);
    expect(result.branch).toBe("BRE-101-signals");

    // The drone branch must have NO extra commits added by mergeDrone
    // (status was clean, so no auto-commit should have been created).
    const droneLogAfter = await runGit(
      repoPath,
      "log",
      "BRE-101-signals",
      "--oneline"
    );
    const droneCommitsAfter = droneLogAfter.stdout.split("\n").length;
    expect(droneCommitsAfter).toBe(droneCommitsBefore);

    // minds/main should have a new merge commit.
    expect(result.commitHash).toBeTruthy();
  });

  it("returns conflict info when merge fails and leaves the repo clean", async () => {
    const repoPath = tmpPath("repo-conflict");
    const worktreePath = tmpPath("wt-conflict");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-102-execution");

    // Drone modifies shared.ts.
    writeFileSync(join(worktreePath, "shared.ts"), "export const v = 'drone';\n");
    await runGit(worktreePath, "add", "-A");
    await runGit(worktreePath, "commit", "-m", "feat: drone version");

    // Main repo also modifies shared.ts on minds/main (diverging history).
    writeFileSync(join(repoPath, "shared.ts"), "export const v = 'main';\n");
    await runGit(repoPath, "add", "-A");
    await runGit(repoPath, "commit", "-m", "feat: main version");

    const result = await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
    });

    expect(result.success).toBe(false);
    expect(result.hasConflicts).toBe(true);
    expect(result.branch).toBe("BRE-102-execution");
    expect(result.error).toContain("CONFLICT");

    // Repo must be in a clean state (no lingering MERGE_HEAD).
    const mergeHeadPath = join(repoPath, ".git", "MERGE_HEAD");
    expect(existsSync(mergeHeadPath)).toBe(false);
  });

  it("uses a custom commit message when provided", async () => {
    const repoPath = tmpPath("repo-custommsg");
    const worktreePath = tmpPath("wt-custommsg");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-103-cli");

    writeFileSync(join(worktreePath, "cli.ts"), "export {};\n");

    const result = await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      commitMessage: "chore: custom commit message for test",
      repoRoot: repoPath,
    });

    expect(result.success).toBe(true);

    const log = await runGit(repoPath, "log", "--oneline", "-5");
    expect(log.stdout).toContain("custom commit message for test");
  });

  it("writes a daily log entry when logContent is provided and merge succeeds", async () => {
    const repoPath = tmpPath("repo-logcontent");
    const worktreePath = tmpPath("wt-logcontent");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-104-memory");

    writeFileSync(join(worktreePath, "log-test.ts"), "export {};\n");

    const logFile = dailyLogPath("memory");
    // Ensure clean state before test
    if (existsSync(logFile)) rmSync(logFile);

    const logContent = "Confirmed appendDailyLog path resolution is correct.";
    const result = await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
      logContent,
    });

    expect(result.success).toBe(true);

    try {
      expect(existsSync(logFile)).toBe(true);
      const contents = await Bun.file(logFile).text();
      expect(contents).toContain(logContent);
    } finally {
      if (existsSync(logFile)) rmSync(logFile);
    }
  });

  it("does not write a daily log entry when merge fails due to conflicts", async () => {
    const repoPath = tmpPath("repo-logconflict");
    const worktreePath = tmpPath("wt-logconflict");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-105-memory");

    // Drone modifies shared.ts
    writeFileSync(join(worktreePath, "shared-conflict.ts"), "export const v = 'drone';\n");
    await runGit(worktreePath, "add", "-A");
    await runGit(worktreePath, "commit", "-m", "feat: drone version");

    // Main also modifies shared-conflict.ts (diverging)
    writeFileSync(join(repoPath, "shared-conflict.ts"), "export const v = 'main';\n");
    await runGit(repoPath, "add", "-A");
    await runGit(repoPath, "commit", "-m", "feat: main version");

    const logFile = dailyLogPath("memory");
    // Ensure clean state before test (guards against leaked state from Test A)
    if (existsSync(logFile)) rmSync(logFile);

    const logContent = "Should not be written on conflict.";
    const result = await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
      logContent,
    });

    expect(result.success).toBe(false);
    expect(existsSync(logFile)).toBe(false);
  });

  it("extracts mind name and ticket from branch name for auto-commit message", async () => {
    const repoPath = tmpPath("repo-extract");
    const worktreePath = tmpPath("wt-extract");
    await initRepo(repoPath);
    await addWorktree(repoPath, worktreePath, "BRE-200-router");

    // Leave a file uncommitted so the auto-message path is triggered.
    writeFileSync(join(worktreePath, "router.ts"), "export {};\n");

    const result = await mergeDrone({
      worktreePath,
      targetBranch: "minds/main",
      repoRoot: repoPath,
    });

    expect(result.success).toBe(true);

    // The auto-generated commit should reference the mind and ticket.
    const log = await runGit(repoPath, "log", "--format=%s", "-5");
    expect(log.stdout).toContain("@router");
    expect(log.stdout).toContain("BRE-200");
  });
});
