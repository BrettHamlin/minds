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
  validateTicketIdArg,
  OrchestratorError,
  handleError,
} from "../pipeline_core";
import type { CompiledPipeline } from "../pipeline_core";
import { writeContractPattern } from "../memory/lib/contract-store.js";
import type { ContractPattern } from "../memory/lib/contract-types.js";

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

// ---------------------------------------------------------------------------
// Contract pattern recording
// ---------------------------------------------------------------------------

interface TransitionRecordOpts {
  /** Injectable write function for testing. Defaults to writeContractPattern. */
  writeFn?: (pattern: ContractPattern) => Promise<string>;
}

/**
 * Build a ContractPattern from a known phase transition.
 * Derives artifact shape from the source phase's signals in the pipeline config.
 */
export function buildContractPattern(
  sourcePhase: string,
  targetPhase: string,
  pipeline: CompiledPipeline
): ContractPattern {
  const sourceConfig = (pipeline.phases[sourcePhase] as any) ?? {};
  const signals: string[] = sourceConfig.signals ?? [];

  return {
    sourcePhase,
    targetPhase,
    artifactShape: `${sourcePhase} phase artifacts handed off to ${targetPhase} (signals: ${signals.join(", ") || "none"})`,
    sections: signals.map((signal) => ({
      name: signal,
      required: true,
      description: `Signal emitted by ${sourcePhase} phase on completion`,
    })),
    metadata: { domain: "pipeline" },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Record a phase transition as a ContractPattern in the shared contract store.
 * Called after a successful phase advance so future dispatches can reference
 * historical handoff shapes.
 *
 * Skips recording when targetPhase is "done" (no downstream consumer).
 * Returns null on skip or failure — never blocks phase advance.
 */
export async function recordPhaseTransition(
  sourcePhase: string,
  targetPhase: string,
  pipeline: CompiledPipeline,
  opts?: TransitionRecordOpts
): Promise<string | null> {
  if (targetPhase === "done") return null;
  try {
    const pattern = buildContractPattern(sourcePhase, targetPhase, pipeline);
    const doWrite = opts?.writeFn ?? writeContractPattern;
    return await doWrite(pattern);
  } catch {
    // Never block phase advance on write failure
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "phase-advance.ts");

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
      // Record handoff pattern after successful phase advance
      await recordPhaseTransition(args[1], nextPhase, pipeline as CompiledPipeline);
    }
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main();
}
