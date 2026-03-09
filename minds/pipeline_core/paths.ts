/**
 * paths.ts — Deterministic path construction for pipeline state files.
 *
 * Single source of truth for all file paths used by the pipeline.
 * No LLM judgment: pure functions, deterministic output.
 *
 * Install path: .minds/lib/pipeline/paths.ts
 */

import { join } from "path";

/**
 * Absolute path to the pipeline registry file for a ticket.
 * Format: {repoRoot}/.minds/state/pipeline-registry/{ticketId}.json
 */
export function registryPath(repoRoot: string, ticketId: string): string {
  return join(repoRoot, ".minds", "state", "pipeline-registry", `${ticketId}.json`);
}

/**
 * Absolute path to the signal queue file for a ticket.
 * Format: {repoRoot}/.minds/state/signal-queue/{ticketId}.json
 */
export function signalQueuePath(repoRoot: string, ticketId: string): string {
  return join(repoRoot, ".minds", "state", "signal-queue", `${ticketId}.json`);
}

/**
 * Absolute path to the findings file for a phase/round.
 * Format: {featureDir}/findings/{phase}-round-{round}.json
 */
export function findingsPath(featureDir: string, phase: string, round: number): string {
  return join(featureDir, "findings", `${phase}-round-${round}.json`);
}

/**
 * Absolute path to the resolutions file for a phase/round.
 * Format: {featureDir}/resolutions/{phase}-round-{round}.json
 */
export function resolutionsPath(featureDir: string, phase: string, round: number): string {
  return join(featureDir, "resolutions", `${phase}-round-${round}.json`);
}
