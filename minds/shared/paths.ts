/**
 * paths.ts — Portable path utilities for the Minds system.
 *
 * Provides mindsRoot() and metricsDbPath() so portable Minds
 * never hardcode .collab/ paths.
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

/**
 * Resolve the Minds data root directory.
 *
 * Priority:
 *   1. MINDS_ROOT env var (explicit override)
 *   2. .minds/ directory discovery (walk up from cwd)
 *   3. .collab/ relative to git root (dev fallback)
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

  // 3. Fallback: .collab/ relative to git root (dev mode)
  try {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    return join(root, ".collab");
  } catch {
    return join(process.cwd(), ".collab");
  }
}

/**
 * Path to the metrics SQLite database.
 *
 * Uses mindsRoot() to resolve the base directory so the path is portable
 * across .collab/ (dev) and .minds/ (installed) layouts.
 */
export function metricsDbPath(): string {
  return join(mindsRoot(), "state", "metrics.db");
}
