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
  severity?: "error" | "warning";
  /** If set, this file is owned by another mind — delegate the change to them. */
  ownerMind?: string;
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

/**
 * Find which mind (other than the current one) owns a file.
 * Returns the mind name, or undefined if no mind owns it.
 */
function findOwnerMind(
  file: string,
  currentMind: string,
  allMindsOwnership?: Record<string, string[]>,
): string | undefined {
  if (!allMindsOwnership) return undefined;

  for (const [mind, ownedFiles] of Object.entries(allMindsOwnership)) {
    if (mind === currentMind) continue;
    const localOwned = ownedFiles.map(f => stripRepoPrefix(normalizeMindsPrefix(f)));
    if (matchesOwnership(file, localOwned)) {
      return mind;
    }
  }
  return undefined;
}

// ── Main check function ────────────────────────────────────────────────────

export interface CheckBoundaryOptions {
  /** When true, empty ownsFiles is a hard error instead of a skip. */
  requireBoundary?: boolean;
  /** Additional infrastructure exclusion patterns (merged with defaults). */
  infraExclusions?: string[];
  /** Infrastructure files to allow for this mind (removes from exclusion list). */
  infraAllowed?: string[];
  /** Files explicitly referenced in the drone's task descriptions — pre-approved by task decomposition. */
  taskFiles?: string[];
  /** All minds' ownership: { mindName: owns_files[] }. Used to determine if an out-of-boundary file is owned by another mind or unowned. */
  allMindsOwnership?: Record<string, string[]>;
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

  // Merge custom infra exclusions with defaults, then remove allowed ones
  let infraExcluded = options?.infraExclusions
    ? [...INFRASTRUCTURE_EXCLUDED, ...options.infraExclusions]
    : [...INFRASTRUCTURE_EXCLUDED];
  if (options?.infraAllowed?.length) {
    const allowed = new Set(options.infraAllowed.map(f => normalizeMindsPrefix(f)));
    infraExcluded = infraExcluded.filter(f => !allowed.has(normalizeMindsPrefix(f)));
  }

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

    // Allow files explicitly referenced in task descriptions (pre-approved by task decomposition)
    if (options?.taskFiles?.length) {
      const normalizedTaskFiles = options.taskFiles.map(f => stripRepoPrefix(normalizeMindsPrefix(f)));
      if (normalizedTaskFiles.some(tf => file === tf || file.endsWith(tf) || tf.endsWith(file))) {
        continue;
      }
    }

    // Check ownership boundary (use stripped paths for matching)
    if (!matchesOwnership(file, localOwnsFiles)) {
      // Determine if another mind owns this file, or if it's unowned
      const ownerMind = findOwnerMind(file, mindName, options?.allMindsOwnership);

      if (!ownerMind) {
        // Unowned file — no mind claims it, so allow the change (warning only)
        violations.push({
          file,
          severity: "warning",
          message: `You modified \`${file}\`, which is outside your boundary and not owned by any Mind. ` +
            `Allowed as unowned infrastructure — verify the change is correct.`,
        });
      } else {
        // Owned by another mind — hard violation, delegate to owner
        violations.push({
          file,
          severity: "error",
          ownerMind,
          message: `You modified \`${file}\`, which is owned by @${ownerMind}. ` +
            `Revert your changes to this file. A task will be created for @${ownerMind} to handle this change.`,
        });
      }
    }
  }

  // Pass if no hard errors — warnings (test file modifications) don't block
  const hasErrors = violations.some(v => v.severity !== "warning");
  return { pass: !hasErrors, violations };
}
