/**
 * contract-hygiene.ts — Contract pattern consolidation for the contract store.
 *
 * consolidatePatterns: reads all ContractPattern JSON files from contractDataDir(),
 * groups by phase pair, applies the hybrid frequency + Jaccard sub-clustering
 * algorithm (Candidate C), writes consolidated canonicals back, and syncs the index.
 *
 * Design notes:
 * - Scoped to contracts only — not per-Mind memory (see hygiene.ts for that).
 * - Deterministic: no LLM dependency, no embeddings.
 * - Idempotent: single-pattern groups are skipped; running twice yields same result.
 */

import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { contractDataDir } from "./paths.js";
import { syncContractIndex } from "./index.js";
import { candidateC } from "./contract-eval-candidates.js";
import type { ContractPattern } from "./contract-types.js";

/** Summary of a consolidation run. */
export interface ConsolidationReport {
  /** Total number of distinct phase-pair groups found in the store. */
  groupsFound: number;
  /** Number of canonical patterns written (may be > groupsFound for bimodal groups). */
  canonicalsProduced: number;
  /** Total number of source patterns merged into canonicals. */
  patternsMerged: number;
  /** Number of sub-clusters detected (bimodal groups contribute 2+ each). */
  subClustersDetected: number;
}

/**
 * Consolidates contract patterns in the store using the hybrid frequency +
 * Jaccard sub-clustering algorithm (Candidate C).
 *
 * For each phase-pair group with >= 2 patterns:
 *   1. Runs candidateC to produce 1 or 2 canonical patterns.
 *   2. Deletes the source files.
 *   3. Writes the canonical(s) back to contractDataDir().
 *
 * Single-pattern groups are left unchanged (nothing to consolidate).
 * Syncs the contract FTS5 index once after all writes.
 *
 * @returns A ConsolidationReport describing what was processed.
 */
export async function consolidatePatterns(): Promise<ConsolidationReport> {
  const dir = contractDataDir();

  if (!existsSync(dir)) {
    return { groupsFound: 0, canonicalsProduced: 0, patternsMerged: 0, subClustersDetected: 0 };
  }

  // Read and parse all JSON files in the contracts directory
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const entries: Array<{ filePath: string; pattern: ContractPattern }> = [];

  for (const file of files) {
    const filePath = join(dir, file);
    try {
      const raw = readFileSync(filePath, "utf8");
      const pattern = JSON.parse(raw) as ContractPattern;
      // Validate minimum required fields before accepting the entry
      if (
        typeof pattern.sourcePhase === "string" &&
        typeof pattern.targetPhase === "string" &&
        Array.isArray(pattern.sections)
      ) {
        entries.push({ filePath, pattern });
      }
    } catch {
      // Skip malformed or unreadable files
    }
  }

  if (entries.length === 0) {
    return { groupsFound: 0, canonicalsProduced: 0, patternsMerged: 0, subClustersDetected: 0 };
  }

  // Group entries by phase pair key
  const groups = new Map<string, Array<{ filePath: string; pattern: ContractPattern }>>();
  for (const entry of entries) {
    const key = `${entry.pattern.sourcePhase}::${entry.pattern.targetPhase}`;
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const groupsFound = groups.size;
  let canonicalsProduced = 0;
  let patternsMerged = 0;
  let subClustersDetected = 0;

  for (const [, group] of groups) {
    // Skip single-pattern groups — idempotency: nothing to merge
    if (group.length < 2) continue;

    const patterns = group.map((e) => e.pattern);
    const result = candidateC(patterns);

    if (result.clusterCount > 1) {
      subClustersDetected += result.clusterCount;
    }

    // Delete source files before writing canonicals
    for (const entry of group) {
      try {
        unlinkSync(entry.filePath);
      } catch {
        // Best-effort deletion — continue even if file was already removed
      }
    }

    // Write canonical(s) with unique filenames.
    // Use Date.now() + idx to guarantee uniqueness even for bimodal groups
    // where both canonicals are produced in the same millisecond.
    const baseEpoch = Date.now();
    for (let idx = 0; idx < result.canonicals.length; idx++) {
      const canonical = result.canonicals[idx];
      const epochMs = baseEpoch + idx;
      const safeName = `${sanitizeSegment(canonical.sourcePhase)}-${sanitizeSegment(canonical.targetPhase)}-${epochMs}.json`;
      const filePath = join(dir, safeName);
      writeFileSync(filePath, JSON.stringify(canonical, null, 2), "utf8");
      canonicalsProduced++;
    }

    patternsMerged += group.length;
  }

  // Sync the FTS5 index once after all consolidation writes
  await syncContractIndex();

  return { groupsFound, canonicalsProduced, patternsMerged, subClustersDetected };
}

/**
 * Sanitizes a phase name segment for use in a filename.
 * Replaces non-alphanumeric characters (except hyphens/underscores) with underscores.
 */
function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_-]/g, "_");
}
