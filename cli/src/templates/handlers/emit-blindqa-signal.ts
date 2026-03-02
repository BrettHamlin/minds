#!/usr/bin/env bun
/**
 * emit-blindqa-signal.ts - Deterministic BLINDQA Signal Emission
 *
 * Called directly by relay.blindqa command at key lifecycle points.
 * This gives us full control over signal timing - no dependency on hooks.
 *
 * Pattern: See README.md in this directory for the deterministic signal emission pattern.
 *
 * Usage:
 *   bun emit-blindqa-signal.ts start "Starting blind verification"
 *   bun emit-blindqa-signal.ts pass "All checks passed"
 *   bun emit-blindqa-signal.ts fail "3 issues found"
 */

import { $ } from "bun";
import { execSync } from "child_process";
import * as fs from "fs";

// Detect repo root and use local paths
function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
}

const REPO_ROOT = getRepoRoot();
const REGISTRY_DIR = `${REPO_ROOT}/.collab/state/pipeline-registry`;
const TMUX_PATH = `${REPO_ROOT}/.collab/scripts/orchestrator/Tmux.ts`;

// Import shared functions from local pipeline-signal handler
const { mapResponseState, buildSignalMessage, resolveRegistry, truncateDetail } =
  await import("./pipeline-signal.ts");

/**
 * Map lifecycle event to response state for mapResponseState function
 *
 * mapResponseState("completed", "blindqa") → BLINDQA_COMPLETE
 * mapResponseState("failed", "blindqa") → BLINDQA_FAILED
 * mapResponseState("error", "blindqa") → BLINDQA_ERROR
 */
function getResponseState(event: string): string {
  switch (event) {
    case "start":
      // There's no "starting" state in mapResponseState, use awaitingInput as placeholder
      // awaitingInput maps to _QUESTION suffix, emitting BLINDQA_QUESTION (not BLINDQA_WAITING; that signal exists in pipeline.json for future use)
      return "awaitingInput";
    case "pass":
      return "completed";
    case "fail":
      return "failed";
    default:
      console.error(`[EmitBlindQASignal] Unknown event: ${event}`);
      return "completed";
  }
}

async function main() {
  const event = process.argv[2]; // "start", "pass", "fail"
  const detailText = process.argv[3] || `BlindQA ${event}`;

  if (!event) {
    console.error('[EmitBlindQASignal] Usage: bun emit-blindqa-signal.ts <start|pass|fail> "detail message"');
    process.exit(1);
  }

  try {
    // Get current registry
    const registry = await resolveRegistry();
    if (!registry) {
      console.error('[EmitBlindQASignal] No registry found - not in orchestrated mode');
      process.exit(0);
    }

    // Verify we're in blindqa phase
    if (registry.current_step !== "blindqa") {
      console.error(`[EmitBlindQASignal] Warning: current_step is "${registry.current_step}", expected "blindqa"`);
    }

    // Build phase-specific signal (BLINDQA_COMPLETE, BLINDQA_FAILED, etc.)
    const responseState = getResponseState(event);
    const status = mapResponseState(responseState, registry.current_step);
    const detail = truncateDetail(detailText);
    const signalMessage = buildSignalMessage(registry, status, detail);

    // Persist signal to queue before tmux send (survives orchestrator context compaction)
    const queueDir = `${REPO_ROOT}/.collab/state/signal-queue`;
    fs.mkdirSync(queueDir, { recursive: true });
    const queueFile = `${queueDir}/${registry.ticket_id}.json`;
    const queueTmp = `${queueFile}.tmp`;
    fs.writeFileSync(queueTmp, JSON.stringify({ signal: signalMessage, emitted_at: new Date().toISOString() }, null, 2) + "\n");
    fs.renameSync(queueTmp, queueFile);

    // Send to orchestrator pane
    const target = registry.orchestrator_pane_id || registry.orchestrator_window_id;
    await $`bun ${TMUX_PATH} send -w ${target} -t ${signalMessage} -d 1`.quiet();

    console.error(`[EmitBlindQASignal] Sent ${status} to ${target}`);
    console.error(`[EmitBlindQASignal] Event: ${event}, Detail: ${detailText}`);
  } catch (error) {
    console.error('[EmitBlindQASignal] Error:', error);
    process.exit(1);
  }
}

main();
