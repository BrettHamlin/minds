#!/usr/bin/env bun

/**
 * resolve-retry-config.ts — Deterministic retry configuration resolver
 *
 * Reads the current attempt count from the registry's phase_history and the
 * maximum attempts from the pipeline config. Replaces hardcoded max_attempts
 * in collab.blindqa.md and provides a single deterministic source of truth
 * that survives context compaction.
 *
 * Usage:
 *   bun resolve-retry-config.ts <TICKET_ID> <phase>
 *
 * Output (JSON to stdout):
 *   { "currentAttempt": 1, "maxAttempts": 3, "exhausted": false }
 *   { "currentAttempt": 3, "maxAttempts": 3, "exhausted": true }
 *
 * How attempt counting works:
 *   currentAttempt = (number of phase_history entries for <phase>) + 1
 *   This is accurate because phase_history accumulates one entry per
 *   completed phase run and survives context compaction.
 *
 * How maxAttempts is resolved:
 *   1. phases[phase].max_retries from pipeline config
 *   2. Global max_retries from pipeline config (if per-phase not set)
 *   3. Default: 3
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error
 *   3 = registry or pipeline config not found
 */

import {
  getRepoRoot,
  readJsonFile,
  loadPipelineForTicket,
  validateTicketIdArg,
} from "../pipeline_core";
import { registryPath } from "../pipeline_core/paths"; // CROSS-MIND

const DEFAULT_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Count the number of completed runs for a phase by scanning phase_history.
 * Each entry in phase_history represents one completed phase run.
 */
export function countPhaseAttempts(
  phaseHistory: Array<{ phase: string; signal: string }>,
  phaseId: string
): number {
  return phaseHistory.filter((entry) => entry.phase === phaseId).length;
}

/**
 * Resolve max retries for a phase from the pipeline config.
 * Checks per-phase max_retries first, then global, then default.
 */
export function resolveMaxRetries(
  pipeline: Record<string, any>,
  phaseId: string
): number {
  const perPhase = pipeline.phases?.[phaseId]?.max_retries;
  if (typeof perPhase === "number") return perPhase;

  const global = pipeline.max_retries;
  if (typeof global === "number") return global;

  return DEFAULT_MAX_RETRIES;
}

export interface RetryConfig {
  currentAttempt: number;
  maxAttempts: number;
  exhausted: boolean;
}

/**
 * Resolve the full retry config for a ticket+phase combination.
 */
export function resolveRetryConfig(
  ticketId: string,
  phaseId: string,
  repoRoot: string
): RetryConfig {
  const regPath = registryPath(repoRoot, ticketId);
  const registry = readJsonFile(regPath);

  if (!registry) {
    throw new Error(`Registry not found for ticket: ${ticketId}`);
  }

  const history = (registry.phase_history ?? []) as Array<{
    phase: string;
    signal: string;
  }>;

  const pastAttempts = countPhaseAttempts(history, phaseId);
  const currentAttempt = pastAttempts + 1;

  const { pipeline } = loadPipelineForTicket(repoRoot, ticketId);
  const maxAttempts = resolveMaxRetries(pipeline, phaseId);

  return {
    currentAttempt,
    maxAttempts,
    exhausted: currentAttempt > maxAttempts,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  validateTicketIdArg(args, "resolve-retry-config.ts");

  if (args.length < 2) {
    console.error("Usage: resolve-retry-config.ts <TICKET_ID> <phase>");
    process.exit(1);
  }

  const ticketId = args[0];
  const phaseId = args[1];

  const repoRoot = getRepoRoot();

  try {
    const config = resolveRetryConfig(ticketId, phaseId, repoRoot);
    console.log(JSON.stringify(config));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Registry not found") || msg.includes("Pipeline config")) {
      console.error(JSON.stringify({ error: msg }));
      process.exit(3);
    }
    console.error(JSON.stringify({ error: msg }));
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
