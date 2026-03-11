/**
 * boundary-check.ts — Deterministic boundary enforcement for Mind drones.
 *
 * Parses a git diff to extract modified file paths, then verifies each
 * file falls within the Mind's declared `owns_files` prefixes and does
 * not touch infrastructure files that no drone should modify.
 */

import { normalizeMindsPrefix } from "../../shared/paths.ts";

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

// ── Prefix normalization ───────────────────────────────────────────────────

/**
 * Strip trailing glob patterns from an owns_files entry to get the directory prefix.
 * e.g. "src/middleware/cors/**" → "src/middleware/cors/"
 *      "src/middleware/cors/"   → "src/middleware/cors/"
 *      "src/middleware/cors"    → "src/middleware/cors"
 */
function stripGlob(pattern: string): string {
  return pattern.replace(/\*+$/, "").replace(/\/+$/, "/");
}

/**
 * Check whether a file path matches at least one owns_files prefix.
 * Handles `.minds/` vs `minds/` normalization and glob stripping on both sides.
 */
function matchesOwnership(filePath: string, ownsFiles: string[]): boolean {
  const normalizedFile = normalizeMindsPrefix(filePath);

  for (const prefix of ownsFiles) {
    const normalizedPrefix = stripGlob(normalizeMindsPrefix(prefix));
    if (normalizedFile.startsWith(normalizedPrefix)) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether a file path matches an infrastructure exclusion.
 */
function isInfrastructureFile(filePath: string): boolean {
  const normalizedFile = normalizeMindsPrefix(filePath);

  for (const excluded of INFRASTRUCTURE_EXCLUDED) {
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

export function checkBoundary(
  diff: string,
  ownsFiles: string[],
  mindName: string,
): BoundaryCheckResult {
  const violations: BoundaryViolation[] = [];
  const modifiedFiles = parseDiffPaths(diff);

  for (const file of modifiedFiles) {
    // Check infrastructure exclusion first
    if (isInfrastructureFile(file)) {
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
    if (ownsFiles.length === 0) {
      continue;
    }

    // Check ownership boundary
    if (!matchesOwnership(file, ownsFiles)) {
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
