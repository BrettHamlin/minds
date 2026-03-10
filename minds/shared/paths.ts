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
 * Resolve the Minds data root directory.
 *
 * Priority:
 *   1. MINDS_ROOT env var (explicit override)
 *   2. .minds/ directory discovery (walk up from cwd)
 *   3. git root with dev-repo-aware detection
 */
export function mindsRoot(): string {
  // 1. Explicit env var
  if (process.env.MINDS_ROOT) return process.env.MINDS_ROOT;

  // 2. Walk up from cwd looking for .minds/ directory
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".minds");
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }

  // 3. Fallback: use git root with dev-repo detection
  try {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    return resolveMindsDir(root);
  } catch {
    return join(process.cwd(), ".minds");
  }
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
