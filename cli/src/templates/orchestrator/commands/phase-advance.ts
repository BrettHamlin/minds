#!/usr/bin/env bun

/**
 * phase-advance.ts - Determine the next phase after the current one
 *
 * Reads phase ordering from pipeline.json using object insertion order
 * (equivalent to jq's keys_unsorted). Returns the next phase name to stdout.
 *
 * Usage:
 *   bun commands/phase-advance.ts <CURRENT_PHASE>         # next phase
 *   bun commands/phase-advance.ts --first                 # first phase key
 *   bun commands/phase-advance.ts --is-terminal <PHASE>   # "true" or "false"
 *
 * Output (stdout):
 *   Phase name, "done", "true", or "false"
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error
 *   2 = validation error (unknown phase)
 *   3 = file error (pipeline.json missing or malformed)
 */

import {
  getRepoRoot,
  readJsonFile,
  OrchestratorError,
  handleError,
} from "../../../lib/pipeline";
import type { CompiledPipeline } from "../../../lib/pipeline";

/**
 * Get the next phase ID from pipeline.json given the current phase.
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
 * Get the first phase ID from pipeline.json using insertion order.
 */
export function getFirstPhase(pipeline: CompiledPipeline): string {
  const phaseIds = Object.keys(pipeline.phases);
  if (phaseIds.length === 0) {
    throw new OrchestratorError("VALIDATION", "Pipeline has no phases");
  }
  return phaseIds[0];
}

/**
 * Return true if the given phase ID is marked terminal in pipeline.json.
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
  if (args.length < 1) {
    console.error(
      "Usage: phase-advance.ts <CURRENT_PHASE>\n" +
      "       phase-advance.ts --first\n" +
      "       phase-advance.ts --is-terminal <PHASE>"
    );
    process.exit(1);
  }

  try {
    const repoRoot = getRepoRoot();
    const configPath = `${repoRoot}/.collab/config/pipeline.json`;
    const pipeline = readJsonFile(configPath) as CompiledPipeline | null;

    if (pipeline === null) {
      throw new OrchestratorError("FILE_NOT_FOUND", `pipeline.json not found: ${configPath}`);
    }

    if (!pipeline.phases || typeof pipeline.phases !== "object" || Array.isArray(pipeline.phases)) {
      throw new OrchestratorError("FILE_NOT_FOUND", `pipeline.json is malformed: expected phases object`);
    }

    if (args[0] === "--first") {
      console.log(getFirstPhase(pipeline));
    } else if (args[0] === "--is-terminal") {
      if (args.length < 2) {
        throw new OrchestratorError("USAGE", "Usage: phase-advance.ts --is-terminal <PHASE>");
      }
      console.log(isTerminalPhase(pipeline, args[1]) ? "true" : "false");
    } else {
      const nextPhase = getNextPhase(pipeline, args[0]);
      console.log(nextPhase);
    }
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main();
}
