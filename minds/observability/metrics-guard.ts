/**
 * metrics-guard.ts — Observability Mind helper
 *
 * Provides exitIfMetricsDisabled, used by all system-node CLIs that
 * conditionally skip when pipeline.metrics.enabled === false.
 *
 * Extracted from orchestrator-utils.ts (which re-exported from lib/pipeline).
 */

// TODO(WD): readJsonFile should be requested via parent escalation once Pipeline Core is a Mind.
import { readJsonFile } from "@minds/pipeline_core/json-io"; // CROSS-MIND

/**
 * Check @metrics directive and exit 3 if metrics are disabled.
 * Extracted from the identical 5-line block repeated in all system node CLIs.
 */
export function exitIfMetricsDisabled(repoRoot: string): void {
  const pipeline = readJsonFile(`${repoRoot}/.collab/config/pipeline.json`);
  if (pipeline?.metrics?.enabled === false) {
    console.log(JSON.stringify({ skipped: true, reason: "@metrics(false)" }));
    process.exit(3);
  }
}
