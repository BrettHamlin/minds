#!/usr/bin/env bun

/**
 * registry-update.ts - Update ticket registry atomically
 *
 * Applies field=value updates or appends phase_history entries to a
 * ticket registry file using atomic write (tmp + rename).
 *
 * Usage:
 *   bun registry-update.ts BRE-158 current_step=plan
 *   bun registry-update.ts BRE-158 current_step=implement status=active
 *   bun registry-update.ts BRE-158 --append-phase-history '{"phase":"plan","signal":"PLAN_COMPLETE","ts":"..."}'
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error (missing arguments, invalid field=value format)
 *   2 = validation error (invalid field name)
 *   3 = file error (registry not found, write failure)
 */

import {
  getRepoRoot,
  readJsonFile,
  writeJsonAtomic,
  getRegistryPath,
} from "./orchestrator-utils";

import { ALLOWED_FIELDS, parseFieldValue, applyUpdates, appendPhaseHistory } from "../../lib/pipeline/registry";
import { openMetricsDb, ensureRun, recordPhase } from "../../lib/pipeline/metrics";

// Re-export for test backward compatibility
export { ALLOWED_FIELDS, parseFieldValue, applyUpdates, appendPhaseHistory } from "../../lib/pipeline/registry";

// ============================================================================
// CLI Entry Point
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      "Usage: registry-update.ts <TICKET_ID> <field=value> [field=value ...]"
    );
    console.error(
      "       registry-update.ts <TICKET_ID> --append-phase-history '<json-entry>'"
    );
    process.exit(1);
  }

  const ticketId = args[0];
  const repoRoot = getRepoRoot();
  const registryDir = `${repoRoot}/.collab/state/pipeline-registry`;
  const registryPath = getRegistryPath(registryDir, ticketId);

  // Read existing registry
  const registry = readJsonFile(registryPath);
  if (registry === null) {
    console.error(`Error: Registry not found: ${registryPath}`);
    process.exit(3);
  }

  // Handle --append-phase-history mode
  if (args[1] === "--append-phase-history") {
    if (args.length < 3) {
      console.error(
        "Usage: registry-update.ts <TICKET_ID> --append-phase-history '<json-entry>'"
      );
      process.exit(1);
    }

    let entry: any;
    try {
      entry = JSON.parse(args[2]);
    } catch {
      console.error("Error: Invalid JSON for phase_history entry");
      process.exit(1);
    }

    const updated = appendPhaseHistory(registry, entry);
    try {
      writeJsonAtomic(registryPath, updated);
    } catch {
      console.error("Error: Failed to append phase_history entry");
      process.exit(3);
    }

    // Write phase timing to SQLite metrics store (best-effort, non-fatal)
    try {
      const metricsDb = openMetricsDb(`${repoRoot}/.collab/state/metrics.db`);
      recordPhase(metricsDb, {
        ticketId,
        phase: entry.phase ?? "unknown",
        startedAt: entry.ts ?? new Date().toISOString(),
        completedAt: entry.ts ?? null,
        outcome: entry.signal ?? null,
      });
      metricsDb.close();
    } catch {
      // Metrics write failure is non-fatal — JSON registry write succeeded
    }

    console.log(`Appended phase_history entry for ${ticketId}`);
    process.exit(0);
  }

  // Handle field=value updates
  const updates: Record<string, any> = {};
  const appliedPairs: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const parsed = parseFieldValue(args[i]);
    if (!parsed) {
      console.error(
        `Error: Invalid format '${args[i]}'. Expected field=value`
      );
      process.exit(1);
    }

    if (!ALLOWED_FIELDS.has(parsed.field)) {
      console.error(
        `Error: Invalid field name '${parsed.field}'. Allowed: ${[...ALLOWED_FIELDS].join(" ")}`
      );
      process.exit(2);
    }

    updates[parsed.field] = parsed.value;
    appliedPairs.push(args[i]);
  }

  const updated = applyUpdates(registry, updates);

  try {
    writeJsonAtomic(registryPath, updated);
  } catch {
    console.error("Error: Failed to apply updates");
    process.exit(3);
  }

  // Ensure run row exists in SQLite metrics store (best-effort, non-fatal)
  try {
    const metricsDb = openMetricsDb(`${repoRoot}/.collab/state/metrics.db`);
    ensureRun(metricsDb, ticketId, registry.repo_id ?? null);
    metricsDb.close();
  } catch {
    // Metrics write failure is non-fatal — JSON registry write succeeded
  }

  console.log(`Updated ${ticketId}: ${appliedPairs.join(" ")}`);
}

// Only run CLI when executed directly (not imported)
if (import.meta.main) {
  main();
}
