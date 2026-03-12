/**
 * cleanup-multirepo.test.ts — Tests for multi-repo cleanup (MR-018).
 *
 * Verifies:
 * - Orphan detection across additional repos
 * - Without additional repos: backward compat
 * - Worktree pruning runs on all repos
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { removeOrphanedClaudeDirs, pruneOrphanedWorktrees } from "../cleanup.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tempDir(): string {
  const dir = join(tmpdir(), `cleanup-mr-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function initGitRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  Bun.spawnSync(["git", "init", dir], { stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "-C", dir, "config", "user.email", "test@test.com"], { stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "-C", dir, "config", "user.name", "Test"], { stdout: "pipe", stderr: "pipe" });
  writeFileSync(join(dir, "README.md"), "init");
  Bun.spawnSync(["git", "-C", dir, "add", "."], { stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "-C", dir, "commit", "-m", "init"], { stdout: "pipe", stderr: "pipe" });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("removeOrphanedClaudeDirs — multi-repo (MR-018)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = tempDir();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("works without additional repos (backward compat)", () => {
    const repoRoot = join(tmpRoot, "solo");
    initGitRepo(repoRoot);

    // Should not throw
    const result = removeOrphanedClaudeDirs(repoRoot);
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
  });

  test("accepts additional repo roots", () => {
    const repoA = join(tmpRoot, "repoA");
    const repoB = join(tmpRoot, "repoB");
    initGitRepo(repoA);
    initGitRepo(repoB);

    // Should not throw, should merge worktree lists from both repos
    const result = removeOrphanedClaudeDirs(repoA, [repoB]);
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
  });

  test("additional repos with no worktrees returns clean result", () => {
    const repoA = join(tmpRoot, "repoA");
    const repoB = join(tmpRoot, "repoB");
    initGitRepo(repoA);
    initGitRepo(repoB);

    const result = removeOrphanedClaudeDirs(repoA, [repoB]);
    expect(result.errors).toHaveLength(0);
  });
});

describe("pruneOrphanedWorktrees (MR-018)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = tempDir();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("runs on all repos without error", () => {
    const repoA = join(tmpRoot, "repoA");
    const repoB = join(tmpRoot, "repoB");
    initGitRepo(repoA);
    initGitRepo(repoB);

    // Should not throw
    expect(() => pruneOrphanedWorktrees([repoA, repoB])).not.toThrow();
  });

  test("handles empty array", () => {
    expect(() => pruneOrphanedWorktrees([])).not.toThrow();
  });

  test("handles single repo", () => {
    const repo = join(tmpRoot, "solo");
    initGitRepo(repo);

    expect(() => pruneOrphanedWorktrees([repo])).not.toThrow();
  });

  test("prunes stale worktree after manual deletion", () => {
    const repo = join(tmpRoot, "repo");
    initGitRepo(repo);

    // Create a worktree
    const wtPath = join(tmpRoot, "wt-test");
    Bun.spawnSync(["git", "-C", repo, "worktree", "add", wtPath, "-b", "test-branch"], { stdout: "pipe", stderr: "pipe" });
    expect(existsSync(wtPath)).toBe(true);

    // Manually delete the worktree directory (simulating a crash)
    rmSync(wtPath, { recursive: true, force: true });

    // Git still knows about the stale worktree
    const listBefore = Bun.spawnSync(["git", "-C", repo, "worktree", "list", "--porcelain"], { stdout: "pipe" });
    const beforeOutput = new TextDecoder().decode(listBefore.stdout);
    expect(beforeOutput).toContain(wtPath);

    // Prune should clean it up
    pruneOrphanedWorktrees([repo]);

    const listAfter = Bun.spawnSync(["git", "-C", repo, "worktree", "list", "--porcelain"], { stdout: "pipe" });
    const afterOutput = new TextDecoder().decode(listAfter.stdout);
    expect(afterOutput).not.toContain(wtPath);
  });
});
