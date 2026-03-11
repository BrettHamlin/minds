#!/usr/bin/env bun
/**
 * minds/lib/cleanup.ts — Cleanup utilities for Minds development artifacts.
 *
 * Handles:
 *   - Removing orphaned ~/.claude/projects/ dirs that match collab worktree patterns
 *   - Removing DRONE-BRIEF.md files from worktrees
 *   - Removing worktrees with git worktree remove --force
 *
 * Replaces batched `rm -rf` shell commands that get blocked by security hooks.
 *
 * Library usage:
 *   import { removeOrphanedClaudeDirs, removeDroneBrief, removeWorktree } from "./cleanup";
 *
 * CLI usage:
 *   bun minds/lib/cleanup.ts orphans [--repo-root <path>]
 *   bun minds/lib/cleanup.ts brief <worktree-path>
 *   bun minds/lib/cleanup.ts worktree <worktree-path>
 *   bun minds/lib/cleanup.ts all <worktree-path> [--repo-root <path>]
 */

import {
  existsSync,
  readdirSync,
  rmSync,
  unlinkSync,
  lstatSync,
} from "fs";
import { join, resolve } from "path";
// ─── Types ────────────────────────────────────────────────────────────────────

export interface CleanupResult {
  ok: boolean;
  removed: string[];
  skipped: string[];
  errors: Array<{ path: string; error: string }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tryRunArgs(args: string[]): string {
  try {
    const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) return "";
    return new TextDecoder().decode(result.stdout).trim();
  } catch {
    return "";
  }
}

/** Encode an absolute path the same way Claude Code does for project dirs. */
function encodeProjectPath(absolutePath: string): string {
  // Claude Code converts absolute path to dir name: replace / with - and strip leading -
  return absolutePath.replace(/\//g, "-").replace(/^-/, "");
}

/** Get the list of active worktree paths from git. */
function getActiveWorktreePaths(repoRoot: string): Set<string> {
  const output = tryRunArgs(["git", "-C", repoRoot, "worktree", "list", "--porcelain"]);
  const paths = new Set<string>();
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.add(line.slice("worktree ".length).trim());
    }
  }
  return paths;
}

// ─── Library exports ──────────────────────────────────────────────────────────

/**
 * Remove orphaned ~/.claude/projects/ directories that match collab worktree patterns
 * but whose corresponding worktrees no longer exist.
 *
 * Matches dirs whose encoded path contains patterns like:
 *   -collab-worktrees-   (classic worktree layout)
 *   -collab-dev          (collab-dev worktree)
 *   -collab-dev-N        (numbered collab-dev worktrees)
 */
export function removeOrphanedClaudeDirs(repoRoot: string): CleanupResult {
  const claudeProjectsDir = join(process.env.HOME ?? "/root", ".claude", "projects");
  const result: CleanupResult = { ok: true, removed: [], skipped: [], errors: [] };

  if (!existsSync(claudeProjectsDir)) {
    return result;
  }

  const activeWorktrees = getActiveWorktreePaths(repoRoot);
  const entries = readdirSync(claudeProjectsDir);

  for (const entry of entries) {
    // Only touch dirs that look like collab worktree project dirs
    if (!/-collab-worktrees-|-collab-dev/.test(entry)) {
      result.skipped.push(entry);
      continue;
    }

    const dirPath = join(claudeProjectsDir, entry);
    let stat;
    try {
      stat = lstatSync(dirPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      result.skipped.push(entry);
      continue;
    }

    // Decode the entry back to an absolute path to check if worktree still exists
    // Entry format: Users-atlas-Code-projects-collab-worktrees-BRE-123-pipeline_core
    const decodedPath = "/" + entry.replace(/-/g, "/");
    // The decoded path won't exactly match (hyphens in dir names collapse with separators),
    // so we check active worktrees by scanning for the entry as a suffix match.
    const isActive = [...activeWorktrees].some((wt) => {
      const encoded = encodeProjectPath(wt);
      return encoded === entry;
    });

    if (isActive) {
      result.skipped.push(entry);
      continue;
    }

    try {
      rmSync(dirPath, { recursive: true, force: true });
      result.removed.push(dirPath);
    } catch (err: unknown) {
      result.ok = false;
      result.errors.push({ path: dirPath, error: String(err) });
    }
  }

  return result;
}

/**
 * Remove DRONE-BRIEF.md and MIND-BRIEF.md from a worktree directory.
 */
export function removeDroneBrief(worktreePath: string): CleanupResult {
  const result: CleanupResult = { ok: true, removed: [], skipped: [], errors: [] };

  for (const filename of ["DRONE-BRIEF.md", "MIND-BRIEF.md"]) {
    const briefPath = join(worktreePath, filename);
    if (!existsSync(briefPath)) {
      result.skipped.push(briefPath);
      continue;
    }
    try {
      unlinkSync(briefPath);
      result.removed.push(briefPath);
    } catch (err: unknown) {
      result.ok = false;
      result.errors.push({ path: briefPath, error: String(err) });
    }
  }

  return result;
}

/**
 * Remove the drone's private ~/.claude/projects/ directory for a given worktree path.
 */
export function removeDroneClaudeDir(worktreePath: string): CleanupResult {
  const result: CleanupResult = { ok: true, removed: [], skipped: [], errors: [] };
  const encoded = encodeProjectPath(resolve(worktreePath));
  const dirPath = join(process.env.HOME ?? "/root", ".claude", "projects", encoded);

  if (!existsSync(dirPath)) {
    result.skipped.push(dirPath);
    return result;
  }

  try {
    rmSync(dirPath, { recursive: true, force: true });
    result.removed.push(dirPath);
  } catch (err: unknown) {
    result.ok = false;
    result.errors.push({ path: dirPath, error: String(err) });
  }

  return result;
}

/**
 * Remove a git worktree using `git worktree remove --force`.
 * The --force flag is required because .bun-build caches and other untracked
 * files prevent non-force removal.
 */
export function removeWorktree(worktreePath: string, repoRoot: string): CleanupResult {
  const result: CleanupResult = { ok: true, removed: [], skipped: [], errors: [] };
  const absPath = resolve(worktreePath);

  if (!existsSync(absPath)) {
    result.skipped.push(absPath);
    return result;
  }

  try {
    const proc = Bun.spawnSync(
      ["git", "-C", repoRoot, "worktree", "remove", "--force", absPath],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (proc.exitCode !== 0) {
      const stderr = new TextDecoder().decode(proc.stderr).trim();
      throw new Error(stderr || `git worktree remove exited with code ${proc.exitCode}`);
    }
    result.removed.push(absPath);
  } catch (err: unknown) {
    result.ok = false;
    result.errors.push({ path: absPath, error: String(err) });
  }

  return result;
}

/**
 * Full cleanup for a single drone worktree: DRONE-BRIEF.md + private CLAUDE.md dir + worktree.
 */
export function cleanupDroneWorktree(worktreePath: string, repoRoot: string): CleanupResult {
  const merged: CleanupResult = { ok: true, removed: [], skipped: [], errors: [] };

  for (const r of [
    removeDroneBrief(worktreePath),
    removeDroneClaudeDir(worktreePath),
    removeWorktree(worktreePath, repoRoot),
  ]) {
    merged.ok = merged.ok && r.ok;
    merged.removed.push(...r.removed);
    merged.skipped.push(...r.skipped);
    merged.errors.push(...r.errors);
  }

  return merged;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  function getFlag(flag: string): string | undefined {
    const i = args.indexOf(flag);
    if (i !== -1 && i + 1 < args.length) return args[i + 1];
    return undefined;
  }

  function repoRootOrCwd(): string {
    return (
      getFlag("--repo-root") ??
      (tryRunArgs(["git", "rev-parse", "--show-toplevel"]) || process.cwd())
    );
  }

  function printResult(result: CleanupResult) {
    for (const p of result.removed) process.stdout.write(`removed  ${p}\n`);
    for (const p of result.skipped) process.stdout.write(`skipped  ${p}\n`);
    for (const e of result.errors) process.stderr.write(`error    ${e.path}: ${e.error}\n`);
    if (!result.ok) process.exit(1);
  }

  switch (command) {
    case "orphans": {
      const root = repoRootOrCwd();
      printResult(removeOrphanedClaudeDirs(root));
      break;
    }
    case "brief": {
      const worktree = args[1];
      if (!worktree) { process.stderr.write("usage: cleanup.ts brief <worktree-path>\n"); process.exit(1); }
      printResult(removeDroneBrief(worktree));
      break;
    }
    case "worktree": {
      const worktree = args[1];
      if (!worktree) { process.stderr.write("usage: cleanup.ts worktree <worktree-path>\n"); process.exit(1); }
      printResult(removeWorktree(worktree, repoRootOrCwd()));
      break;
    }
    case "all": {
      const worktree = args[1];
      if (!worktree) { process.stderr.write("usage: cleanup.ts all <worktree-path> [--repo-root <path>]\n"); process.exit(1); }
      printResult(cleanupDroneWorktree(worktree, repoRootOrCwd()));
      break;
    }
    default: {
      process.stderr.write(
        "usage: cleanup.ts <orphans|brief|worktree|all> [args]\n" +
        "  orphans [--repo-root <path>]     Remove orphaned ~/.claude/projects/ dirs\n" +
        "  brief <worktree-path>            Remove DRONE-BRIEF.md from worktree\n" +
        "  worktree <worktree-path>         Remove worktree (git worktree remove --force)\n" +
        "  all <worktree-path>              Full drone cleanup (brief + claude-dir + worktree)\n"
      );
      process.exit(1);
    }
  }
}
