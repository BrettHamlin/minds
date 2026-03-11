/**
 * paths.ts — Path utilities for the Minds system.
 *
 * Provides mindsRoot() and metricsDbPath() so core Minds
 * never hardcode .minds/ paths.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

/**
 * Resolve the Minds data directory for a given repo root.
 *
 * Priority:
 *   1. Dev repo: minds/cli/ exists → use minds/ directly (source lives here)
 *   2. Otherwise: .minds/ (installed-repo convention — may not exist yet)
 *
 * Exported so orchestration code with a known repoRoot can call it directly,
 * avoiding duplicated detection logic across implement.ts, mind-pane.ts, etc.
 */
export function resolveMindsDir(repoRoot: string): string {
  // Dev repo: minds/cli/ exists → use minds/ directly
  if (existsSync(join(repoRoot, "minds", "cli"))) return join(repoRoot, "minds");
  // Otherwise: .minds/ (installed-repo convention)
  return join(repoRoot, ".minds");
}

/**
 * Cached result for mindsRoot() so git rev-parse is only called once.
 */
let _cachedMindsRoot: string | null = null;

/**
 * Resolve the Minds data root directory.
 *
 * Priority:
 *   1. MINDS_ROOT env var (explicit override, not cached)
 *   2. git rev-parse --show-toplevel → resolveMindsDir(root)
 *   3. Fallback: cwd + .minds/
 *
 * Result is cached after first resolution (unless MINDS_ROOT env var is set,
 * which is checked fresh each call to allow runtime overrides).
 */
export function mindsRoot(): string {
  // 1. Explicit env var — always checked fresh (allows runtime override)
  if (process.env.MINDS_ROOT) return process.env.MINDS_ROOT;

  // 2. Return cached result if available
  if (_cachedMindsRoot !== null) return _cachedMindsRoot;

  // 3. Use git rev-parse to find repo root, then resolveMindsDir
  try {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    _cachedMindsRoot = resolveMindsDir(root);
    return _cachedMindsRoot;
  } catch {
    _cachedMindsRoot = join(process.cwd(), ".minds");
    return _cachedMindsRoot;
  }
}

/**
 * Clear the cached mindsRoot() value. Useful for testing.
 */
export function _resetMindsRootCache(): void {
  _cachedMindsRoot = null;
}

/**
 * Cached result for getRepoRoot() (default cwd case only).
 */
let _cachedRepoRoot: string | null = null;

/**
 * Detect the git repository root directory.
 *
 * @param cwd - Optional working directory to resolve from.
 *              When provided, the result is NOT cached (different cwd = different root).
 *              When omitted, uses process.cwd() and caches the result.
 * @returns The absolute path to the repo root, or cwd/process.cwd() as fallback.
 */
export function getRepoRoot(cwd?: string): string {
  // When no cwd override, return cached result if available
  if (!cwd && _cachedRepoRoot !== null) return _cachedRepoRoot;

  try {
    const result = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      cwd: cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Only cache when using default cwd
    if (!cwd) _cachedRepoRoot = result;
    return result;
  } catch {
    const fallback = cwd || process.cwd();
    if (!cwd) _cachedRepoRoot = fallback;
    return fallback;
  }
}

/**
 * Clear the cached getRepoRoot() value. Useful for testing.
 */
export function _resetRepoRootCache(): void {
  _cachedRepoRoot = null;
}

/**
 * Normalize a file path prefix: `.minds/` → `minds/` for string comparison.
 *
 * Use this for prefix matching where you need to compare paths regardless
 * of whether they use the dev (`minds/`) or installed (`.minds/`) layout.
 * This is a pure string operation — no filesystem access.
 */
export function normalizeMindsPrefix(filePath: string): string {
  if (filePath.startsWith(".minds/")) {
    return "minds/" + filePath.slice(7);
  }
  return filePath;
}

/**
 * Path to the metrics SQLite database.
 *
 * Uses mindsRoot() to resolve the base directory so the path is portable
 * across dev and installed .minds/ layouts.
 */
export function metricsDbPath(): string {
  return join(mindsRoot(), "state", "metrics.db");
}
