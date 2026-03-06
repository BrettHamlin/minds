#!/usr/bin/env bun
/**
 * pipeline-signal.ts - Shared Signal Utilities
 *
 * Common functions for building and sending pipeline signals.
 * Used by emit-question-signal.ts and emit-blindqa-signal.ts.
 */

import { $ } from "bun";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
// TODO(WD): Should be requested via parent escalation once Router Mind exists (Wave E).
import { loadPipelineForTicket } from "../pipeline_core/pipeline"; // CROSS-MIND

// Detect repo root and use local state directory
function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
}

const REPO_ROOT = getRepoRoot();
const REGISTRY_DIR = `${REPO_ROOT}/.collab/state/pipeline-registry`;

/**
 * Map response state and current step to phase-specific signal type
 *
 * Examples:
 *   mapResponseState("completed", "plan") → "PLAN_COMPLETE"
 *   mapResponseState("awaitingInput", "clarify") → "CLARIFY_QUESTION"
 *   mapResponseState("failed", "blindqa") → "BLINDQA_FAILED"
 */
export function mapResponseState(state: string, currentStep: string): string {
  const stepUpper = currentStep.toUpperCase();

  const stateMap: Record<string, string> = {
    "completed": "COMPLETE",
    "awaitingInput": "QUESTION",
    "processing": "PROCESSING",
    "waiting": "WAITING",
    "failed": "FAILED",
    "error": "ERROR",
    "questions": "QUESTIONS",
  };

  const suffix = stateMap[state] || "COMPLETE";
  return `${stepUpper}_${suffix}`;
}

/**
 * Build formatted signal message for orchestrator consumption
 *
 * Format: [SIGNAL:ticket-id:nonce] STATUS | detail
 * Example: [SIGNAL:BRE-191:a3f9d2c1] PLAN_COMPLETE | Plan review passed
 */
export function buildSignalMessage(
  registry: any,
  status: string,
  detail: string
): string {
  const ticketId = registry.ticket_id;
  const nonce = registry.nonce;
  return `[SIGNAL:${ticketId}:${nonce}] ${status} | ${detail}`;
}

/**
 * Resolve current ticket registry by scanning TMUX_PANE environment
 *
 * Returns registry object or null if not in orchestrated mode
 */
export async function resolveRegistry(): Promise<any | null> {
  const currentPane = process.env.TMUX_PANE;
  if (!currentPane) {
    return null;
  }

  // Scan all registry files for matching agent_pane_id
  if (!fs.existsSync(REGISTRY_DIR)) {
    return null;
  }

  const files = fs.readdirSync(REGISTRY_DIR);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const registryPath = path.join(REGISTRY_DIR, file);
    try {
      const content = fs.readFileSync(registryPath, 'utf-8');
      const registry = JSON.parse(content);

      if (registry.agent_pane_id === currentPane) {
        return registry;
      }
    } catch (error) {
      // Skip malformed registries
      continue;
    }
  }

  return null;
}

/**
 * Truncate detail text to 200 characters for signal format
 */
export function truncateDetail(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + "...";
}

export const SIGNAL_SUFFIXES = {
  SUCCESS: ["COMPLETE", "APPROVED", "PASS"],
  FAIL: ["REJECTED", "FAILED"],
  ERROR: ["ERROR"],
  INFO: ["QUESTION", "QUESTIONS", "WAITING", "PROCESSING"],
} as const;

export function isSuccessSignal(signal: string): boolean {
  return (
    SIGNAL_SUFFIXES.SUCCESS.some((s) => signal.endsWith(s)) &&
    !SIGNAL_SUFFIXES.FAIL.some((s) => signal.endsWith(s)) &&
    !SIGNAL_SUFFIXES.ERROR.some((s) => signal.endsWith(s)) &&
    !SIGNAL_SUFFIXES.INFO.some((s) => signal.endsWith(s))
  );
}

/**
 * Resolve the correct signal name from the pipeline config for a given phase and event.
 *
 * Mapping rules (deterministic):
 *   complete/pass/warn → first signal NOT ending in REJECTED/FAILED/ERROR/QUESTION/QUESTIONS/WAITING/PROCESSING
 *   fail/reject        → first signal ending in REJECTED or FAILED
 *   error              → first signal ending in ERROR
 *   start              → {PHASE_UPPER}_PROCESSING (always informational, never in config)
 *
 * Returns null if no pipeline config found (caller should use mechanical fallback).
 */
export function resolveSignalName(
  phaseName: string,
  event: string,
  registry?: any
): string | null {
  if (!registry?.ticket_id) return null;

  try {
    const loaded = loadPipelineForTicket(REPO_ROOT, registry.ticket_id);
    const phase = loaded.pipeline.phases?.[phaseName];
    if (!phase?.signals || !Array.isArray(phase.signals)) return null;

    const signals: string[] = phase.signals;
    const eventLower = event.toLowerCase();

    if (eventLower === "start") {
      return `${phaseName.toUpperCase()}_PROCESSING`;
    }

    if (["complete", "pass", "warn"].includes(eventLower)) {
      return signals.find((s) => isSuccessSignal(s)) ?? null;
    }

    if (["fail", "reject"].includes(eventLower)) {
      return signals.find((s) => SIGNAL_SUFFIXES.FAIL.some((suf) => s.endsWith(suf))) ?? null;
    }

    if (eventLower === "error") {
      return signals.find((s) => SIGNAL_SUFFIXES.ERROR.some((suf) => s.endsWith(suf))) ?? null;
    }

    return null;
  } catch {
    return null;
  }
}
