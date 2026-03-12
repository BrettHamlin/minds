/**
 * repo-path.ts — Repo-qualified path parsing utilities.
 *
 * Pure functions for parsing, formatting, and resolving paths
 * with optional repo alias prefixes (e.g., "backend:src/api/**").
 *
 * No filesystem access — all operations are string-based.
 */

import { resolve } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedRepoPath {
  repo: string | undefined;
  path: string;
}

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Parse a repo-qualified path into its components.
 * "backend:src/api/**" -> { repo: "backend", path: "src/api/**" }
 * "src/api/**"         -> { repo: undefined, path: "src/api/**" }
 *
 * Splits on the first colon only. Windows drive letters (e.g., C:) are NOT
 * expected in this codebase (Unix-only paths).
 */
export function parseRepoPath(qualifiedPath: string): ParsedRepoPath {
  const colonIdx = qualifiedPath.indexOf(":");
  if (colonIdx === -1) {
    return { repo: undefined, path: qualifiedPath };
  }

  const repo = qualifiedPath.slice(0, colonIdx);
  const path = qualifiedPath.slice(colonIdx + 1);

  // Empty alias means no repo prefix (e.g., ":src/api" is treated as bare path)
  if (repo.length === 0) {
    return { repo: undefined, path: qualifiedPath };
  }

  return { repo, path };
}

/**
 * Format a repo alias and path back into a qualified path string.
 * ("backend", "src/api/**") -> "backend:src/api/**"
 * (undefined, "src/api/**") -> "src/api/**"
 */
export function formatRepoPath(repo: string | undefined, path: string): string {
  if (repo) {
    return `${repo}:${path}`;
  }
  return path;
}

/**
 * Resolve a repo-qualified path to an absolute filesystem path.
 *
 * @param qualifiedPath - A path, optionally prefixed with "repo:"
 * @param repoPaths - Map of alias -> absolute repo root path
 * @param defaultRepoRoot - Fallback root for bare paths (no repo prefix)
 * @returns Absolute resolved path
 * @throws If the repo alias is not found in repoPaths
 */
export function resolveRepoPath(
  qualifiedPath: string,
  repoPaths: Map<string, string>,
  defaultRepoRoot: string,
): string {
  const { repo, path } = parseRepoPath(qualifiedPath);

  if (repo) {
    const repoRoot = repoPaths.get(repo);
    if (!repoRoot) {
      throw new Error(`Unknown repo alias "${repo}" in path "${qualifiedPath}"`);
    }
    return resolve(repoRoot, path);
  }

  return resolve(defaultRepoRoot, path);
}

/**
 * Strip the repo prefix from a qualified path, returning just the path portion.
 * "backend:src/api/**" -> "src/api/**"
 * "src/api/**"         -> "src/api/**"
 */
export function stripRepoPrefix(qualifiedPath: string): string {
  return parseRepoPath(qualifiedPath).path;
}

/**
 * Get the repo alias from a qualified path, or undefined for bare paths.
 * "backend:src/api/**" -> "backend"
 * "src/api/**"         -> undefined
 */
export function getRepoAlias(qualifiedPath: string): string | undefined {
  return parseRepoPath(qualifiedPath).repo;
}
