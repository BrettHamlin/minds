#!/usr/bin/env bun

/**
 * phase-advance.ts - Determine the next phase after the current one
 *
 * Ticket ID is REQUIRED — the script reads the registry to resolve the
 * correct pipeline variant config automatically. No --pipeline flag needed.
 *
 * Usage:
 *   bun phase-advance.ts <TICKET_ID> <CURRENT_PHASE>       # next phase
 *   bun phase-advance.ts <TICKET_ID> --first                # first phase key
 *   bun phase-advance.ts <TICKET_ID> --is-terminal <PHASE>  # "true" or "false"
 *
 * Output (stdout):
 *   Phase name, "done", "true", or "false"
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error
 *   2 = validation error (unknown phase)
 *   3 = file error (pipeline config missing or malformed)
 */

import {
  getRepoRoot,
  loadPipelineForTicket,
  OrchestratorError,
  handleError,
} from "../../../lib/pipeline";
import type { CompiledPipeline } from "../../../lib/pipeline";

/**
 * Get the next phase ID given the current phase.
 * Uses object insertion order (same as jq keys_unsorted).
 * Returns "done" if current is the last phase.
 */
export function getNextPhase(pipeline: CompiledPipeline, currentPhase: string): string {
  if (currentPhase === "done") {
    return "done";
  }

  const phaseIds = Object.keys(pipeline.phases);
  const currentIndex = phaseIds.indexOf(currentPhase);

  if (currentIndex === -1) {
    throw new OrchestratorError(
      "VALIDATION",
      `Invalid phase '${currentPhase}'. Valid phases: ${phaseIds.join(", ")}`
    );
  }

  const nextIndex = currentIndex + 1;
  return nextIndex >= phaseIds.length ? "done" : phaseIds[nextIndex];
}

/**
 * Get the first phase ID using insertion order.
 */
export function getFirstPhase(pipeline: CompiledPipeline): string {
  const phaseIds = Object.keys(pipeline.phases);
  if (phaseIds.length === 0) {
    throw new OrchestratorError("VALIDATION", "Pipeline has no phases");
  }
  return phaseIds[0];
}

/**
 * Return true if the given phase ID is marked terminal.
 * Throws VALIDATION error for unknown phase IDs.
 */
export function isTerminalPhase(pipeline: CompiledPipeline, phaseId: string): boolean {
  const phase = pipeline.phases[phaseId];
  if (phase === undefined) {
    throw new OrchestratorError("VALIDATION", `Unknown phase: '${phaseId}'`);
  }
  return !!(phase as any).terminal;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: phase-advance.ts <TICKET_ID> <CURRENT_PHASE>\n" +
      "       phase-advance.ts <TICKET_ID> --first\n" +
      "       phase-advance.ts <TICKET_ID> --is-terminal <PHASE>"
    );
    process.exit(1);
  }

  try {
    const repoRoot = getRepoRoot();
    const ticketId = args[0];
    const { pipeline } = loadPipelineForTicket(repoRoot, ticketId);

    if (args[1] === "--first") {
      console.log(getFirstPhase(pipeline as CompiledPipeline));
    } else if (args[1] === "--is-terminal") {
      if (args.length < 3) {
        throw new OrchestratorError("USAGE", "Usage: phase-advance.ts <TICKET_ID> --is-terminal <PHASE>");
      }
      console.log(isTerminalPhase(pipeline as CompiledPipeline, args[2]) ? "true" : "false");
    } else {
      const nextPhase = getNextPhase(pipeline as CompiledPipeline, args[1]);
      console.log(nextPhase);
    }
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main();
}
