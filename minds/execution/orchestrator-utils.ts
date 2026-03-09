#!/usr/bin/env bun

/**
 * orchestrator-utils.ts - Re-export barrel for Execution Mind scripts
 *
 * All pipeline utility implementations live in minds/pipeline_core/.
 * This file exists for backward compatibility within Execution Mind during WD migration.
 */

import { readJsonFile } from "../pipeline_core/json-io"; // CROSS-MIND

export { getRepoRoot } from "../pipeline_core/repo"; // CROSS-MIND
export { readJsonFile, writeJsonAtomic } from "../pipeline_core/json-io"; // CROSS-MIND
export { validateTicketIdArg } from "../pipeline_core/validation"; // CROSS-MIND
export { resolvePipelineConfigPath, parsePipelineArgs, loadPipelineForTicket } from "../pipeline_core/pipeline"; // CROSS-MIND
export { registryPath } from "../pipeline_core/paths"; // CROSS-MIND

/**
 * Check @metrics directive and exit 3 if metrics are disabled.
 * TODO(WD): Belongs to Observability Mind — move to minds/observability/ in Wave E.
 */
export function exitIfMetricsDisabled(repoRoot: string): void {
  const pipeline = readJsonFile(`${repoRoot}/.collab/config/pipeline.json`);
  if (pipeline?.metrics?.enabled === false) {
    console.log(JSON.stringify({ skipped: true, reason: "@metrics(false)" }));
    process.exit(3);
  }
}
