/**
 * cross-repo-contracts.ts — Post-wave cross-repo contract verification.
 *
 * After a wave completes and merges, verifies deferred cross-repo contract
 * annotations by checking that producer files exist and export the declared
 * interfaces in the producer's actual repo.
 *
 * NOTE: This verifies producer-side only. Consumer-side import verification
 * across repos is not filesystem-resolvable. Consumer compliance relies on
 * depends_on: declarations and wave ordering.
 */

import { existsSync, readFileSync } from "fs";
import type { ContractAnnotation, Violation } from "../check-contracts-core.ts";
import { checkExportExists, resolveFilePath } from "../check-contracts-core.ts";
import { parseRepoPath, stripRepoPrefix } from "../../shared/repo-path.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CrossRepoContractCheck {
  annotation: ContractAnnotation;
  /** Informational — not used for verification. Producer mind is not deterministically
   *  resolvable from the annotation alone (only the file path and repo are known). */
  producerMind: string;
  producerRepo: string;
  consumerMind: string;
  consumerRepo: string;
}

// ── Verification ───────────────────────────────────────────────────────────

/**
 * Verify cross-repo contracts by checking producer files in their respective repos.
 *
 * For each check: resolves the file path against the producer's repo root,
 * reads the file, and verifies the export exists using checkExportExists().
 */
export function verifyCrossRepoContracts(
  checks: CrossRepoContractCheck[],
  repoPaths: Map<string, string>,
  defaultRepoRoot: string,
): { pass: boolean; violations: Violation[] } {
  const violations: Violation[] = [];

  for (const check of checks) {
    const producerRoot = repoPaths.get(check.producerRepo) ?? defaultRepoRoot;
    const localPath = stripRepoPrefix(check.annotation.filePath);
    const fullPath = resolveFilePath(localPath, producerRoot);

    if (!existsSync(fullPath)) {
      violations.push({
        annotation: check.annotation,
        reason: `Cross-repo: file does not exist in repo '${check.producerRepo}': ${localPath}`,
      });
      continue;
    }

    const content = readFileSync(fullPath, "utf-8");
    if (!checkExportExists(content, check.annotation.interfaceName)) {
      violations.push({
        annotation: check.annotation,
        reason: `Cross-repo: '${check.annotation.interfaceName}' is NOT exported from ${localPath} in repo '${check.producerRepo}'`,
      });
    }
  }

  return { pass: violations.length === 0, violations };
}

// ── Builder ────────────────────────────────────────────────────────────────

/**
 * Build CrossRepoContractCheck objects from deferred annotations and mind info.
 *
 * Each deferred annotation comes from a consumer mind whose contract references
 * a file in a different repo. The producer repo is extracted from the filePath's
 * repo prefix.
 */
export function buildCrossRepoChecks(
  deferredByMind: Array<{ mindName: string; repo?: string; annotations: ContractAnnotation[] }>,
): CrossRepoContractCheck[] {
  const checks: CrossRepoContractCheck[] = [];

  for (const { mindName, repo, annotations } of deferredByMind) {
    for (const ann of annotations) {
      const parsed = parseRepoPath(ann.filePath);
      if (!parsed.repo) continue; // No repo prefix — shouldn't be deferred, skip

      checks.push({
        annotation: ann,
        producerMind: "(cross-repo)",
        producerRepo: parsed.repo,
        consumerMind: mindName,
        consumerRepo: repo ?? "__default__",
      });
    }
  }

  return checks;
}
