#!/usr/bin/env bun

/**
 * signal-validate.ts - Parse and validate signals from agent pane
 *
 * Parse signal strings, validate against the ticket registry (nonce match,
 * phase correctness), and output structured JSON.
 *
 * Signal format:
 *   [SIGNAL:{TICKET_ID}:{NONCE}] {SIGNAL_TYPE} | {DETAIL}
 *
 * Usage:
 *   bun signal-validate.ts "[SIGNAL:BRE-158:abc12] CLARIFY_COMPLETE | All questions answered"
 *
 * Exit codes:
 *   0 = valid signal (JSON on stdout)
 *   1 = usage error (no input)
 *   2 = validation error (bad format, nonce mismatch, wrong phase)
 *   3 = file error (registry not found)
 */

import { getRepoRoot, readJsonFile, getRegistryPath } from "./orchestrator-utils";

// ============================================================================
// Types
// ============================================================================

export interface ParsedSignal {
  ticketId: string;
  nonce: string;
  signalType: string;
  detail: string;
}

export type ValidationResult =
  | {
      valid: true;
      ticket_id: string;
      signal_type: string;
      detail: string;
      current_step: string;
      nonce: string;
    }
  | {
      valid: false;
      error: string;
      [key: string]: any;
    };

// ============================================================================
// Constants
// ============================================================================

const SIGNAL_REGEX =
  /^\[SIGNAL:([A-Z]+-[0-9]+):([a-f0-9]+)\] ([A-Z_]+) \| (.+)$/;

// ============================================================================
// Pure Functions
// ============================================================================

/**
 * Parse a raw signal string into its components.
 * Returns null if the format does not match the expected regex.
 */
export function parseSignal(raw: string): ParsedSignal | null {
  const match = raw.match(SIGNAL_REGEX);
  if (!match) return null;

  return {
    ticketId: match[1],
    nonce: match[2],
    signalType: match[3],
    detail: match[4],
  };
}

/**
 * Get allowed signal types for a phase from pipeline.json.
 */
function getAllowedSignals(pipeline: any, phaseId: string): string[] | null {
  if (!pipeline?.phases || !Array.isArray(pipeline.phases)) return null;
  const phase = pipeline.phases.find((p: any) => p.id === phaseId);
  if (!phase || !Array.isArray(phase.signals)) return null;
  return phase.signals;
}

/**
 * Validate a parsed signal against the registry and pipeline config.
 *
 * Checks:
 *   1. Nonce matches registry's nonce
 *   2. Signal type is in the current phase's allowed signals list
 */
export function validateSignal(
  parsed: ParsedSignal,
  registry: any,
  pipeline: any
): ValidationResult {
  const expectedNonce = registry?.nonce;
  const currentStep = registry?.current_step;

  // Validate nonce
  if (parsed.nonce !== expectedNonce) {
    return {
      valid: false,
      error: "Nonce mismatch",
      ticket_id: parsed.ticketId,
      expected_nonce: expectedNonce,
      received_nonce: parsed.nonce,
    };
  }

  // Validate signal type for current phase
  const allowed = getAllowedSignals(pipeline, currentStep);

  if (allowed === null) {
    return {
      valid: false,
      error: "Unknown current_step in registry",
      ticket_id: parsed.ticketId,
      current_step: currentStep,
    };
  }

  if (!allowed.includes(parsed.signalType)) {
    return {
      valid: false,
      error: "Signal type not valid for current phase",
      ticket_id: parsed.ticketId,
      signal_type: parsed.signalType,
      current_step: currentStep,
      allowed_signals: allowed,
    };
  }

  return {
    valid: true,
    ticket_id: parsed.ticketId,
    signal_type: parsed.signalType,
    detail: parsed.detail,
    current_step: currentStep,
    nonce: parsed.nonce,
  };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);
  const signal = args.join(" ");

  if (!signal) {
    console.error(
      JSON.stringify({ valid: false, error: "No signal provided." })
    );
    process.exit(1);
  }

  // Parse signal format
  const parsed = parseSignal(signal);
  if (!parsed) {
    console.error(
      JSON.stringify({
        valid: false,
        error: "Signal format invalid",
        raw: signal,
      })
    );
    process.exit(2);
  }

  const repoRoot = getRepoRoot();
  const registryDir = `${repoRoot}/.collab/state/pipeline-registry`;
  const configPath = `${repoRoot}/.collab/config/pipeline.json`;

  // Read registry
  const registryPath = getRegistryPath(registryDir, parsed.ticketId);
  const registry = readJsonFile(registryPath);
  if (registry === null) {
    console.error(
      JSON.stringify({
        valid: false,
        error: "Registry not found for ticket",
        ticket_id: parsed.ticketId,
      })
    );
    process.exit(3);
  }

  // Read pipeline config
  const pipeline = readJsonFile(configPath);
  if (pipeline === null) {
    console.error(
      JSON.stringify({
        valid: false,
        error: "pipeline.json not found or malformed",
      })
    );
    process.exit(3);
  }

  // Validate
  const result = validateSignal(parsed, registry, pipeline);

  if (result.valid) {
    console.log(JSON.stringify(result));
    process.exit(0);
  } else {
    console.error(JSON.stringify(result));
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
