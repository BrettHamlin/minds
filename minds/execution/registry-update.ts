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
 *   bun registry-update.ts BRE-158 implement_phase_plan='{"total_phases":3,...}'
 *   bun registry-update.ts BRE-158 --append-phase-history '{"phase":"plan","signal":"PLAN_COMPLETE","ts":"..."}'
 *   bun registry-update.ts BRE-158 --advance-impl-phase
 *   bun registry-update.ts BRE-158 --delete-field implement_phase_plan
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
  registryPath,
  validateTicketIdArg,
} from "./orchestrator-utils";

import { ALLOWED_FIELDS, parseFieldValue, applyUpdates, appendPhaseHistory, advanceImplPhase, deleteField } from "../pipeline_core/registry"; // CROSS-MIND
// TODO(WD): Direct import — replace with parent escalation when Observability becomes a full Mind in Wave D.
import { openMetricsDb, ensureRun, recordPhase, insertIntervention } from "../observability/metrics"; // CROSS-MIND

// Re-export for test backward compatibility
export { ALLOWED_FIELDS, parseFieldValue, applyUpdates, appendPhaseHistory, advanceImplPhase, deleteField } from "../pipeline_core/registry"; // CROSS-MIND

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find the terminal phase name from a compiled pipeline config.
 * Supports both v3.1 object-keyed and legacy array formats.
 * Returns null when pipeline is absent or no terminal phase is declared.
 */
function findTerminalPhase(pipeline: any): string | null {
  if (!pipeline?.phases) return null;
  if (Array.isArray(pipeline.phases)) {
    const p = pipeline.phases.find((p: any) => p.terminal === true);
    return p?.id ?? null;
  }
  for (const [id, phase] of Object.entries(pipeline.phases as Record<string, any>)) {
    if ((phase as any)?.terminal === true) return id;
  }
  return null;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "registry-update.ts");

  if (args.length < 2) {
    console.error(
      "Usage: registry-update.ts <TICKET_ID> <field=value> [field=value ...]"
    );
    console.error(
      "       registry-update.ts <TICKET_ID> --append-phase-history '<json-entry>'"
    );
    console.error(
      "       registry-update.ts <TICKET_ID> --advance-impl-phase"
    );
    console.error(
      "       registry-update.ts <TICKET_ID> --delete-field <field-name>"
    );
    process.exit(1);
  }

  const ticketId = args[0];
  const repoRoot = getRepoRoot();
  const regPath = registryPath(repoRoot, ticketId);

  // Read existing registry
  const registry = readJsonFile(regPath);
  if (registry === null) {
    console.error(`Error: Registry not found: ${regPath}`);
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
      writeJsonAtomic(regPath, updated);
    } catch {
      console.error("Error: Failed to append phase_history entry");
      process.exit(3);
    }

    // Write phase timing to SQLite metrics store (best-effort, non-fatal)
    try {
      const metricsDb = openMetricsDb(`${repoRoot}/.minds/state/metrics.db`);
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

  // Handle --advance-impl-phase mode
  if (args[1] === "--advance-impl-phase") {
    let updated: Record<string, any>;
    try {
      updated = advanceImplPhase(registry);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    try {
      writeJsonAtomic(regPath, updated);
    } catch {
      console.error("Error: Failed to advance impl phase");
      process.exit(3);
    }
    const plan = updated.implement_phase_plan;
    console.log(`Advanced impl phase for ${ticketId}: now at phase ${plan.current_impl_phase} of ${plan.total_phases}`);
    process.exit(0);
  }

  // Handle --delete-field mode
  if (args[1] === "--delete-field") {
    if (args.length < 3) {
      console.error("Usage: registry-update.ts <TICKET_ID> --delete-field <field-name>");
      process.exit(1);
    }
    const fieldToDelete = args[2];
    const updated = deleteField(registry, fieldToDelete);
    try {
      writeJsonAtomic(regPath, updated);
    } catch {
      console.error("Error: Failed to delete field");
      process.exit(3);
    }
    console.log(`Deleted field '${fieldToDelete}' from ${ticketId}`);
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
    writeJsonAtomic(regPath, updated);
  } catch {
    console.error("Error: Failed to apply updates");
    process.exit(3);
  }

  // Ensure run row exists; detect manual terminal-status override (best-effort, non-fatal)
  try {
    const metricsDb = openMetricsDb(`${repoRoot}/.minds/state/metrics.db`);
    ensureRun(metricsDb, ticketId, registry.repo_id ?? null);

    // If status is being force-set to a terminal value outside normal phase flow,
    // log it as a manual_fix intervention so autonomy rate reflects the override.
    //
    // Guard: skip if current_step is already the terminal phase — that means the
    // pipeline completed normally and the orchestrator is just closing out the run.
    // Only flag when current_step is mid-pipeline (e.g., still in impl) and someone
    // force-sets status=done, which skips normal phase progression.
    const MANUAL_TERMINAL_STATUSES = new Set(["done", "complete", "abandoned", "aborted"]);
    if (updates.status !== undefined && MANUAL_TERMINAL_STATUSES.has(updates.status)) {
      const pipeline = readJsonFile(`${repoRoot}/.minds/config/pipeline.json`);
      const terminalPhase = findTerminalPhase(pipeline);
      const currentStep = registry.current_step ?? null;
      // Log intervention only when not already at the terminal phase
      if (terminalPhase === null || currentStep !== terminalPhase) {
        insertIntervention(
          metricsDb,
          ticketId,
          currentStep,
          "manual_fix",
          `Status force-set to '${updates.status}' via registry-update`
        );
      }
    }

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
