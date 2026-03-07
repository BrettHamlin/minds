#!/usr/bin/env bun

/**
 * goal-gate-check.ts - Verify goal gate requirements before terminal advance
 *
 * Before advancing to the terminal phase ("done"), check that all phases
 * with a goal_gate field in pipeline.json have been satisfied in this
 * ticket's phase_history.
 *
 * goal_gate values:
 *   "always"       - phase MUST appear in phase_history with a _COMPLETE signal
 *   "if_triggered" - only required if phase_history contains ANY entry for this phase
 *
 * This is a generic interpreter: goal gate requirements live in pipeline.json.
 * Adding, removing, or changing goal gates requires NO changes to this script.
 *
 * Usage:
 *   bun goal-gate-check.ts <TICKET_ID> <NEXT_PHASE>
 *
 * Output (stdout):
 *   "PASS" - all goal gates satisfied (or NEXT is not terminal)
 *   "REDIRECT:<phase_id>" - first failing phase that must complete first
 *
 * Exit codes:
 *   0 = all gates passed (stdout contains "PASS")
 *   1 = usage error
 *   2 = gate failure (stdout contains "REDIRECT:<phase_id>")
 *   3 = file error (registry or pipeline.json missing)
 */

import { getRepoRoot, readJsonFile, registryPath, resolvePipelineConfigPath } from "./orchestrator-utils";
import type { PhaseHistoryEntry } from "../../lib/pipeline/registry";

// Re-export types for test backward compatibility
export type { PhaseHistoryEntry } from "../../lib/pipeline/registry";

// ============================================================================
// Types
// ============================================================================

export interface GatedPhase {
  id: string;
  goal_gate: "always" | "if_triggered";
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Check goal gates against phase history.
 *
 * Returns null (PASS) if all gates are satisfied, or the first failing
 * phase_id (REDIRECT) if a gate fails.
 *
 * This is a pure function with no file I/O.
 */
export function checkGoalGates(
  phaseHistory: PhaseHistoryEntry[],
  gatedPhases: GatedPhase[]
): string | null {
  for (const gated of gatedPhases) {
    const entriesForPhase = phaseHistory.filter(
      (entry) => entry.phase === gated.id
    );
    const hasComplete = entriesForPhase.some((entry) =>
      entry.signal.endsWith("_COMPLETE")
    );

    switch (gated.goal_gate) {
      case "always":
        if (!hasComplete) {
          return gated.id;
        }
        break;

      case "if_triggered":
        if (entriesForPhase.length > 0 && !hasComplete) {
          return gated.id;
        }
        break;
    }
  }

  return null;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: goal-gate-check.ts <TICKET_ID> <NEXT_PHASE>");
    process.exit(1);
  }

  const ticketId = args[0];
  const nextPhase = args[1];

  const repoRoot = getRepoRoot();

  // Resolve pipeline config (variant-aware via registry)
  const regPath = registryPath(repoRoot, ticketId);
  const registry = readJsonFile(regPath);
  const variant = registry?.pipeline_variant as string | undefined;
  const effectiveRoot = (registry?.repo_path as string | undefined) ?? repoRoot;
  const configPath = resolvePipelineConfigPath(effectiveRoot, { variant });

  // Read pipeline config
  const pipeline = readJsonFile(configPath);
  if (pipeline === null) {
    console.error(`Error: pipeline config not found: ${configPath}`);
    process.exit(3);
  }

  // Guard: only check goal gates when advancing to a terminal phase
  // Supports both object-keyed (v3.1) and legacy array format
  let isTerminal = false;
  if (pipeline.phases && !Array.isArray(pipeline.phases)) {
    // Object-keyed format (v3.1)
    isTerminal = pipeline.phases[nextPhase]?.terminal === true;
  } else if (Array.isArray(pipeline.phases)) {
    // Legacy array format
    const targetPhase = pipeline.phases?.find((p: any) => p.id === nextPhase);
    isTerminal = targetPhase?.terminal === true;
  }

  if (!isTerminal) {
    console.log("PASS");
    process.exit(0);
  }

  // Registry already loaded above for variant resolution
  if (registry === null) {
    console.error(`Error: Registry not found for ticket: ${ticketId}`);
    process.exit(3);
  }

  // Get phase history and gated phases
  const phaseHistory: PhaseHistoryEntry[] = registry.phase_history || [];
  let gatedPhases: GatedPhase[] = [];

  if (pipeline.phases && !Array.isArray(pipeline.phases)) {
    // Object-keyed format (v3.1)
    gatedPhases = Object.entries(pipeline.phases)
      .filter(([, v]: [string, any]) => v.goal_gate != null)
      .map(([id, v]: [string, any]) => ({ id, goal_gate: v.goal_gate }));
  } else if (Array.isArray(pipeline.phases)) {
    // Legacy array format
    gatedPhases = (pipeline.phases || [])
      .filter((p: any) => p.goal_gate != null)
      .map((p: any) => ({ id: p.id, goal_gate: p.goal_gate }));
  }

  if (gatedPhases.length === 0) {
    console.log("PASS");
    process.exit(0);
  }

  // Evaluate gates
  const failingPhase = checkGoalGates(phaseHistory, gatedPhases);

  if (failingPhase !== null) {
    console.log(`REDIRECT:${failingPhase}`);
    process.exit(2);
  }

  console.log("PASS");
}

if (import.meta.main) {
  main();
}
