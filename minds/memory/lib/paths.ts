/**
 * paths.ts — Deterministic path resolution for per-Mind memory directories.
 *
 * Single source of truth for all memory file paths.
 * No LLM judgment: pure functions, deterministic output.
 *
 * All memory code must use these functions — never construct paths inline.
 */

import { join } from "path";

/** Root directory of the collab repo (where minds/ lives). */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * Absolute path to the shared contract data directory.
 * Stores ContractPattern JSON files for cross-Mind handoff patterns.
 * Format: {repoRoot}/minds/contracts
 */
export function contractDataDir(): string {
  return join(REPO_ROOT, "minds", "contracts");
}

/**
 * Absolute path to the SQLite FTS5 index for the contracts scope.
 * Format: {repoRoot}/minds/contracts/.index.db
 */
export function contractIndexPath(): string {
  return join(contractDataDir(), ".index.db");
}

/**
 * Absolute path to a Mind's memory directory.
 * Format: {repoRoot}/minds/{mindName}/memory
 */
export function memoryDir(mindName: string): string {
  return join(REPO_ROOT, "minds", mindName, "memory");
}

/**
 * Absolute path to a Mind's curated memory file.
 * Format: {repoRoot}/minds/{mindName}/memory/MEMORY.md
 */
export function memoryMdPath(mindName: string): string {
  return join(memoryDir(mindName), "MEMORY.md");
}

/**
 * Absolute path to a Mind's daily log file.
 * Format: {repoRoot}/minds/{mindName}/memory/YYYY-MM-DD.md
 *
 * @param mindName - Name of the Mind
 * @param date - ISO date string (YYYY-MM-DD). Defaults to today's date.
 */
export function dailyLogPath(mindName: string, date?: string): string {
  const day = date ?? new Date().toISOString().slice(0, 10);
  return join(memoryDir(mindName), `${day}.md`);
}
