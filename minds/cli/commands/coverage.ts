/**
 * coverage.ts — CLI command handler for `minds coverage`.
 *
 * Walks the repo for all source files (via `git ls-files`), builds a union
 * of all minds' owns_files globs, and reports which files are unowned.
 * Advisory only — helps humans identify coverage gaps.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { MindDescription } from "../../mind.ts";
import { matchesOwnership, resolveMindsDir, getRepoRoot } from "../../shared/paths.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoverageResult {
  allCovered: boolean;
  totalFiles: number;
  coveredFiles: number;
  unownedFiles: string[];
  /** Unowned files grouped by their parent directory. */
  groupedByDir: Record<string, string[]>;
}

// ─── Excluded path prefixes ──────────────────────────────────────────────────

const EXCLUDED_PREFIXES = [
  ".git/",
  "node_modules/",
  "dist/",
  "minds/",
  ".minds/",
];

function isExcluded(filePath: string): boolean {
  for (const prefix of EXCLUDED_PREFIXES) {
    if (filePath.startsWith(prefix)) return true;
  }
  return false;
}

// ─── Core logic (testable) ──────────────────────────────────────────────────

/**
 * Check file coverage for a given repo root.
 * Uses `git ls-files` to enumerate tracked files, loads minds.json,
 * and checks each file against the union of all minds' owns_files.
 */
export function checkCoverage(repoRoot: string): CoverageResult {
  // 1. Load minds.json
  const mindsDir = resolveMindsDir(repoRoot);
  const mindsJsonPath = join(mindsDir, "minds.json");

  let registry: MindDescription[] = [];
  if (existsSync(mindsJsonPath)) {
    registry = JSON.parse(readFileSync(mindsJsonPath, "utf-8"));
  }

  // 2. Build union of all owns_files
  const allOwnsFiles: string[] = [];
  for (const mind of registry) {
    if (mind.owns_files && mind.owns_files.length > 0) {
      allOwnsFiles.push(...mind.owns_files);
    }
  }

  // 3. Enumerate tracked files via git ls-files
  const proc = Bun.spawnSync(["git", "ls-files"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = new TextDecoder().decode(proc.stdout);
  const allFiles = stdout
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  // 4. Filter out excluded paths and check ownership
  const candidateFiles = allFiles.filter((f) => !isExcluded(f));
  const unownedFiles: string[] = [];

  for (const file of candidateFiles) {
    if (allOwnsFiles.length === 0 || !matchesOwnership(file, allOwnsFiles)) {
      unownedFiles.push(file);
    }
  }

  // 5. Group unowned files by directory
  const groupedByDir: Record<string, string[]> = {};
  for (const file of unownedFiles) {
    const dir = dirname(file);
    if (!groupedByDir[dir]) groupedByDir[dir] = [];
    groupedByDir[dir].push(file);
  }

  return {
    allCovered: unownedFiles.length === 0,
    totalFiles: candidateFiles.length,
    coveredFiles: candidateFiles.length - unownedFiles.length,
    unownedFiles,
    groupedByDir,
  };
}

// ─── CLI command handler ────────────────────────────────────────────────────

export async function runCoverage(): Promise<void> {
  const repoRoot = getRepoRoot();
  const result = checkCoverage(repoRoot);

  if (result.allCovered) {
    console.log(`All files covered. ${result.totalFiles} file(s) matched by minds' owns_files.`);
    return;
  }

  console.log(
    `Coverage: ${result.coveredFiles}/${result.totalFiles} files covered.\n`
  );
  console.log(`Unowned files (${result.unownedFiles.length}):\n`);

  // Display grouped by directory
  const dirs = Object.keys(result.groupedByDir).sort();
  for (const dir of dirs) {
    const files = result.groupedByDir[dir].sort();
    console.log(`  ${dir}/`);
    for (const file of files) {
      console.log(`    ${file}`);
    }
  }

  console.log(
    `\n${result.unownedFiles.length} file(s) not covered by any mind's owns_files.`
  );
  console.log("Consider adding owns: annotations to your task definitions.");
}
