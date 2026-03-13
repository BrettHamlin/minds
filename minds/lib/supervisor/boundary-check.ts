/**
 * boundary-check.ts — Deterministic boundary enforcement for Mind drones.
 *
 * Parses a git diff to extract modified file paths, then verifies each
 * file falls within the Mind's declared `owns_files` prefixes and does
 * not touch infrastructure files that no drone should modify.
 */

import { normalizeMindsPrefix, matchesOwnership } from "../../shared/paths.ts";
import { stripRepoPrefix } from "../../shared/repo-path.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export interface BoundaryViolation {
  file: string;
  message: string;
}

export interface BoundaryCheckResult {
  pass: boolean;
  violations: BoundaryViolation[];
}

// ── Infrastructure exclusion list ──────────────────────────────────────────

/**
 * Files/prefixes that no drone should modify during implementation.
 * These are project-level infrastructure managed by the orchestrator.
 */
const INFRASTRUCTURE_EXCLUDED: string[] = [
  "package.json",
  "bun.lock",
  "tsconfig.json",
  "CLAUDE.md",
  ".claude/",
  "minds/minds.json",
  "minds/tsconfig.json",
  "minds/STANDARDS.md",
  "minds/STANDARDS-project.md",
];

// ── Diff parsing ───────────────────────────────────────────────────────────

/**
 * Extract modified file paths from a unified diff.
 * Parses `diff --git a/X b/Y` lines and returns the `b/Y` path with `b/` stripped.
 */
export function parseDiffPaths(diff: string): string[] {
  const paths: string[] = [];
  const lines = diff.split("\n");

  for (const line of lines) {
    const match = line.match(/^diff --git a\/\S+ b\/(.+)$/);
    if (match) {
      paths.push(match[1]);
    }
  }

  return paths;
}

/**
 * Check whether a file path matches an infrastructure exclusion.
 */
function isInfrastructureFile(filePath: string, infraExcluded: string[] = INFRASTRUCTURE_EXCLUDED): boolean {
  const normalizedFile = normalizeMindsPrefix(filePath);

  for (const excluded of infraExcluded) {
    const normalizedExcluded = normalizeMindsPrefix(excluded);

    // Directory prefix match (entries ending with /)
    if (normalizedExcluded.endsWith("/")) {
      if (normalizedFile.startsWith(normalizedExcluded)) {
        return true;
      }
    } else {
      // Exact match
      if (normalizedFile === normalizedExcluded) {
        return true;
      }
    }
  }

  return false;
}

// ── Main check function ────────────────────────────────────────────────────

export interface CheckBoundaryOptions {
  /** When true, empty ownsFiles is a hard error instead of a skip. */
  requireBoundary?: boolean;
  /** Additional infrastructure exclusion patterns (merged with defaults). */
  infraExclusions?: string[];
}

export function checkBoundary(
  diff: string,
  ownsFiles: string[],
  mindName: string,
  options?: CheckBoundaryOptions,
): BoundaryCheckResult {
  const violations: BoundaryViolation[] = [];
  const modifiedFiles = parseDiffPaths(diff);

  // Strip repo prefixes for matching (diff paths are repo-relative)
  const localOwnsFiles = ownsFiles.map(f => stripRepoPrefix(f));

  // Merge custom infra exclusions with defaults
  const infraExcluded = options?.infraExclusions
    ? [...INFRASTRUCTURE_EXCLUDED, ...options.infraExclusions]
    : INFRASTRUCTURE_EXCLUDED;

  // Hard error: requireBoundary + empty ownsFiles means no boundary defined
  if (options?.requireBoundary && ownsFiles.length === 0) {
    return {
      pass: false,
      violations: [{
        file: "",
        message: `No boundary defined for @${mindName}. All new minds must declare owns_files via owns: annotation or minds.json.`,
      }],
    };
  }

  for (const file of modifiedFiles) {
    // Check infrastructure exclusion first
    if (isInfrastructureFile(file, infraExcluded)) {
      violations.push({
        file,
        message: `You modified \`${file}\`, which is a protected infrastructure file ` +
          `(package.json, lock files, tsconfig, CLAUDE.md, etc.). ` +
          `No Mind should modify infrastructure files during implementation. ` +
          `Revert your changes to this file.`,
      });
      continue;
    }

    // Skip ownership check if no boundary defined
    if (localOwnsFiles.length === 0) {
      continue;
    }

    // Check ownership boundary (use stripped paths for matching)
    if (!matchesOwnership(file, localOwnsFiles)) {
      // Show original (with-prefix) owns_files in violation messages for clarity
      const allowedDirs = ownsFiles.map((p) => `  - ${p}`).join("\n");
      violations.push({
        file,
        message: `You modified \`${file}\`, which is outside your boundary. ` +
          `As @${mindName}, you may only modify files within:\n${allowedDirs}\n` +
          `Revert your changes to this file. If the task requires changes here, ` +
          `skip that part — it belongs to a different Mind.`,
      });
    }
  }

  return { pass: violations.length === 0, violations };
}
