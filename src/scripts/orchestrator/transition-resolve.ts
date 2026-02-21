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

import { getRepoRoot, readJsonFile } from "./orchestrator-utils";

// ============================================================================
// Types
// ============================================================================

export interface TransitionResult {
  to: string | null;
  gate: string | null;
  if: string | null;
  conditional: boolean;
}

interface TransitionRow {
  from: string;
  signal: string;
  to?: string;
  gate?: string;
  if?: string;
}

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Resolve a transition given the current phase and signal type.
 *
 * Priority rules (FR-014):
 *   1. Rows with an "if" field are evaluated first (conditional) -- first match wins
 *   2. If no conditional row matches, use the first plain row (no "if" field)
 *   3. If no match at all, return null
 *
 * When plainOnly is true, conditional rows are skipped entirely.
 */
export function resolveTransition(
  currentPhase: string,
  signalType: string,
  pipeline: any,
  plainOnly?: boolean
): TransitionResult | null {
  if (!pipeline?.transitions || !Array.isArray(pipeline.transitions)) {
    return null;
  }

  // Filter to matching from + signal
  const matches: TransitionRow[] = pipeline.transitions.filter(
    (t: TransitionRow) => t.from === currentPhase && t.signal === signalType
  );

  if (matches.length === 0) {
    return null;
  }

  // Try conditional rows first (unless plainOnly)
  if (!plainOnly) {
    const conditional = matches.find((t) => t.if != null);
    if (conditional) {
      return {
        to: conditional.to ?? null,
        gate: conditional.gate ?? null,
        if: conditional.if ?? null,
        conditional: true,
      };
    }
  }

  // Fall back to first plain row
  const plain = matches.find((t) => t.if == null);
  if (plain) {
    return {
      to: plain.to ?? null,
      gate: plain.gate ?? null,
      if: null,
      conditional: false,
    };
  }

  // No plain row but we had conditional rows -- return first match anyway
  const first = matches[0];
  return {
    to: first.to ?? null,
    gate: first.gate ?? null,
    if: first.if ?? null,
    conditional: first.if != null,
  };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error(
      "Usage: transition-resolve.ts <CURRENT_PHASE> <SIGNAL_TYPE> [--plain]"
    );
    process.exit(1);
  }

  const currentPhase = args[0];
  const signalType = args[1];
  const plainOnly = args.includes("--plain");

  const repoRoot = getRepoRoot();
  const configPath = `${repoRoot}/.collab/config/pipeline.json`;
  const pipeline = readJsonFile(configPath);

  if (pipeline === null) {
    console.error(`Error: pipeline.json not found or malformed: ${configPath}`);
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
