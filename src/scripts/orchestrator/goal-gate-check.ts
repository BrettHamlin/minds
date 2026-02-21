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

import { getRepoRoot, readJsonFile, getRegistryPath } from "./orchestrator-utils";

// ============================================================================
// Types
// ============================================================================

export interface GatedPhase {
  id: string;
  goal_gate: "always" | "if_triggered";
}

export interface PhaseHistoryEntry {
  phase: string;
  signal: string;
  ts: string;
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
        // Phase MUST have a _COMPLETE signal in history
        if (!hasComplete) {
          return gated.id;
        }
        break;

      case "if_triggered":
        // Only required if ANY entry exists for this phase
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
  const configPath = `${repoRoot}/.collab/config/pipeline.json`;
  const registryDir = `${repoRoot}/.collab/state/pipeline-registry`;

  // Read pipeline config
  const pipeline = readJsonFile(configPath);
  if (pipeline === null) {
    console.error(`Error: pipeline.json not found: ${configPath}`);
    process.exit(3);
  }

  // Guard: only check goal gates when advancing to a terminal phase
  const targetPhase = pipeline.phases?.find((p: any) => p.id === nextPhase);
  if (!targetPhase?.terminal) {
    console.log("PASS");
    process.exit(0);
  }

  // Read registry
  const registryPath = getRegistryPath(registryDir, ticketId);
  const registry = readJsonFile(registryPath);
  if (registry === null) {
    console.error(`Error: Registry not found for ticket: ${ticketId}`);
    process.exit(3);
  }

  // Get phase history and gated phases
  const phaseHistory: PhaseHistoryEntry[] = registry.phase_history || [];
  const gatedPhases: GatedPhase[] = (pipeline.phases || [])
    .filter((p: any) => p.goal_gate != null)
    .map((p: any) => ({ id: p.id, goal_gate: p.goal_gate }));

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
