#!/usr/bin/env bun

/**
 * transition-resolve.ts - Look up matching transition in pipeline.json
 *
 * Given a current phase and incoming signal type, find the matching
 * transition row in pipeline.json and output its target and gate info.
 *
 * This is a generic interpreter: changing transitions in pipeline.json
 * requires NO changes to this script.
 *
 * Usage:
 *   bun transition-resolve.ts <CURRENT_PHASE> <SIGNAL_TYPE> [--plain]
 *
 * Output (stdout, JSON):
 *   {"to": "tasks", "gate": null, "if": null, "conditional": false}
 *
 * Exit codes:
 *   0 = match found
 *   1 = usage error
 *   2 = no matching transition found
 *   3 = file error (pipeline.json missing/malformed)
 */

import { getRepoRoot, readJsonFile, resolvePipelineConfigPath } from "./orchestrator-utils";
import { resolveTransition } from "../../lib/pipeline/transitions";

// Re-export for test backward compatibility
export { resolveTransition } from "../../lib/pipeline/transitions";
export type { TransitionResult } from "../../lib/pipeline/transitions";

/**
 * Look up a gate response object from pipeline.gates[gateName].on[keyword].
 * Returns null if the gate or keyword is not found.
 */
export function resolveGateResponse(
  pipeline: any,
  gateName: string,
  keyword: string
): Record<string, unknown> | null {
  const gate = pipeline?.gates?.[gateName];
  if (!gate) return null;
  return (gate.on?.[keyword] as Record<string, unknown>) ?? null;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function extractTicketFlag(args: string[]): string | undefined {
  const idx = args.indexOf("--ticket");
  if (idx !== -1 && idx + 1 < args.length) {
    const ticketId = args[idx + 1];
    args.splice(idx, 2);
    return ticketId;
  }
  return undefined;
}

function loadPipelineConfig(repoRoot: string, ticketId?: string): any {
  const configPath = resolvePipelineConfigPath(repoRoot, ticketId ? { ticketId } : {});
  return readJsonFile(configPath);
}

/**
 * Detect if the first arg looks like a ticket ID (e.g., BRE-418) rather than
 * a phase name. Ticket IDs contain uppercase letters + hyphen + digits.
 * Phase names are lowercase_snake_case.
 */
function looksLikeTicketId(arg: string): boolean {
  return /^[A-Z]+-\d+$/.test(arg);
}

function main(): void {
  const args = process.argv.slice(2);
  let ticketId = extractTicketFlag(args);

  // Support: transition-resolve.ts <TICKET_ID> <CURRENT_PHASE> <SIGNAL_TYPE>
  // (orchestrator agents naturally pass ticket ID as first positional arg)
  if (!ticketId && args.length >= 3 && args[0] !== "--gate" && looksLikeTicketId(args[0])) {
    ticketId = args.shift()!;
  }

  // --gate GATE_NAME KEYWORD: look up a gate response object
  if (args[0] === "--gate") {
    if (args.length < 3) {
      console.error("Usage: transition-resolve.ts [TICKET_ID] --gate <GATE_NAME> <KEYWORD>");
      process.exit(1);
    }
    const gateName = args[1];
    const keyword = args[2];

    const repoRoot = getRepoRoot();
    const pipeline = loadPipelineConfig(repoRoot, ticketId);

    if (pipeline === null) {
      console.error(`Error: pipeline config not found or malformed`);
      process.exit(3);
    }

    const response = resolveGateResponse(pipeline, gateName, keyword);
    if (response === null) {
      console.error(
        `Error: gate '${gateName}' or keyword '${keyword}' not found in pipeline config`
      );
      process.exit(2);
    }

    console.log(JSON.stringify(response));
    return;
  }

  if (args.length < 2) {
    console.error(
      "Usage: transition-resolve.ts [TICKET_ID] <CURRENT_PHASE> <SIGNAL_TYPE> [--plain]"
    );
    process.exit(1);
  }

  const currentPhase = args[0];
  const signalType = args[1];
  const plainOnly = args.includes("--plain");

  const repoRoot = getRepoRoot();
  const pipeline = loadPipelineConfig(repoRoot, ticketId);

  if (pipeline === null) {
    console.error(`Error: pipeline config not found or malformed`);
    process.exit(3);
  }

  const result = resolveTransition(currentPhase, signalType, pipeline, plainOnly);

  if (result === null) {
    console.error(
      JSON.stringify({
        error: `No transition found for ${currentPhase} \u2192 ${signalType}`,
      })
    );
    process.exit(2);
  }

  console.log(JSON.stringify(result));
}

if (import.meta.main) {
  main();
}
