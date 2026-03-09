/**
 * contract-store.ts — Write contract patterns to the shared contracts store.
 *
 * writeContractPattern: persists a ContractPattern as a JSON file in
 * `minds/contracts/` and syncs the FTS5 index for search.
 *
 * Design notes:
 * - Patterns, not instances: stores artifact shapes, never ticket-specific data.
 * - Cold start safe: creates directory + index on first write.
 * - File naming: {sourcePhase}-{targetPhase}-{epochMs}.json (deterministic, sortable).
 */

import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { contractDataDir } from "./paths.js";
import { syncContractIndex } from "./index.js";
import { provisionContractDir } from "./provision.js";
import type { ContractPattern } from "./contract-types.js";

/**
 * Writes a ContractPattern to the contract data directory as JSON,
 * then syncs the FTS5 contract index so it is immediately searchable.
 *
 * Creates `minds/contracts/` and its README if they don't exist (cold-start safe).
 *
 * @param pattern - The ContractPattern to persist.
 * @returns The absolute path to the written JSON file.
 */
export async function writeContractPattern(pattern: ContractPattern): Promise<string> {
  // Ensure directory exists (idempotent)
  await provisionContractDir();

  const dir = contractDataDir();

  // Derive filename from sourcePhase, targetPhase, and timestamp for uniqueness
  const epochMs = new Date(pattern.timestamp).getTime();
  const safeName = `${sanitizeSegment(pattern.sourcePhase)}-${sanitizeSegment(pattern.targetPhase)}-${epochMs}.json`;
  const filePath = join(dir, safeName);

  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify(pattern, null, 2), "utf8");
  } else {
    // Overwrite if file already exists (e.g. same epoch — deterministic update)
    writeFileSync(filePath, JSON.stringify(pattern, null, 2), "utf8");
  }

  // Sync contract index so this pattern is immediately searchable
  await syncContractIndex();

  return filePath;
}

/**
 * Sanitizes a phase name segment for use in a filename.
 * Replaces non-alphanumeric characters (except hyphens/underscores) with underscores.
 */
function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_-]/g, "_");
}
