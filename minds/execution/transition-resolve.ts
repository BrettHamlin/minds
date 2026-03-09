#!/usr/bin/env bun

/**
 * transition-resolve.ts - Look up matching transition in pipeline config
 *
 * Ticket ID is REQUIRED — the script reads the registry to resolve the
 * correct pipeline variant config automatically. No --pipeline flag needed.
 *
 * Usage:
 *   bun transition-resolve.ts <TICKET_ID> <CURRENT_PHASE> <SIGNAL_TYPE> [--plain]
 *   bun transition-resolve.ts <TICKET_ID> --gate <GATE_NAME> <KEYWORD>
 *
 * Output (stdout, JSON):
 *   {"to": "tasks", "gate": null, "if": null, "conditional": false}
 *
 * Exit codes:
 *   0 = match found
 *   1 = usage error
 *   2 = no matching transition found
 *   3 = file error (pipeline config missing/malformed)
 */

import { getRepoRoot, loadPipelineForTicket, validateTicketIdArg } from "../pipeline_core";
import { resolveTransition } from "../pipeline_core/transitions"; // CROSS-MIND

// Re-export for test backward compatibility
export { resolveTransition } from "../pipeline_core/transitions"; // CROSS-MIND
export type { TransitionResult } from "../pipeline_core/transitions"; // CROSS-MIND

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

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "transition-resolve.ts");

  if (args.length < 2) {
    console.error(
      "Usage: transition-resolve.ts <TICKET_ID> <CURRENT_PHASE> <SIGNAL_TYPE> [--plain]\n" +
      "       transition-resolve.ts <TICKET_ID> --gate <GATE_NAME> <KEYWORD>"
    );
    process.exit(1);
  }

  const repoRoot = getRepoRoot();
  const ticketId = args[0];
  const { pipeline } = loadPipelineForTicket(repoRoot, ticketId);

  // --gate GATE_NAME KEYWORD: look up a gate response object
  if (args[1] === "--gate") {
    if (args.length < 4) {
      console.error("Usage: transition-resolve.ts <TICKET_ID> --gate <GATE_NAME> <KEYWORD>");
      process.exit(1);
    }
    const gateName = args[2];
    const keyword = args[3];

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

  if (args.length < 3) {
    console.error(
      "Usage: transition-resolve.ts <TICKET_ID> <CURRENT_PHASE> <SIGNAL_TYPE> [--plain]"
    );
    process.exit(1);
  }

  const currentPhase = args[1];
  const signalType = args[2];
  const plainOnly = args.includes("--plain");

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
