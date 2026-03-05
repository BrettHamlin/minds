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
