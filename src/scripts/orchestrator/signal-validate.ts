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
import { parseSignal, getAllowedSignals, type ParsedSignal } from "../../lib/pipeline/signal";

// Re-export for test backward compatibility
export { parseSignal } from "../../lib/pipeline/signal";

// ============================================================================
// Types
// ============================================================================

export type { ParsedSignal } from "../../lib/pipeline/signal";

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
// Pure Functions
// ============================================================================

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

  // Resolve pipeline.json: use repo_path from registry if present (multi-repo),
  // fall back to current repo
  const repoPath = registry.repo_path as string | undefined;
  const configPath = repoPath
    ? `${repoPath}/.collab/config/pipeline.json`
    : `${repoRoot}/.collab/config/pipeline.json`;

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
