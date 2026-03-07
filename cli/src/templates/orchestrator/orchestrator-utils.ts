#!/usr/bin/env bun

/**
 * orchestrator-utils.ts - Shared utilities for orchestrator scripts
 *
 * Re-exports from minds/pipeline_core/utils (distributed via lib-pipeline template).
 * All orchestrator scripts import from here; tests import from here.
 */

import { getRepoRoot, readJsonFile, writeJsonAtomic } from "../../lib/pipeline/utils";
import { registryPath } from "../../lib/pipeline/paths";
export { getRepoRoot, readJsonFile, writeJsonAtomic, registryPath };

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
