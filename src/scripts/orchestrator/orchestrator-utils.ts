#!/usr/bin/env bun

/**
 * orchestrator-utils.ts - Shared utilities for orchestrator scripts
 *
 * Re-exports from src/lib/pipeline/utils for backward compatibility.
 * All orchestrator scripts import from here; tests import from here.
 */

import { getRepoRoot, readJsonFile, writeJsonAtomic, resolvePipelineConfigPath, parsePipelineArgs, loadPipelineForTicket, validateTicketIdArg } from "../../lib/pipeline/utils";
import { registryPath } from "../../lib/pipeline/paths";
export { getRepoRoot, readJsonFile, writeJsonAtomic, registryPath, resolvePipelineConfigPath, parsePipelineArgs, loadPipelineForTicket, validateTicketIdArg };

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
