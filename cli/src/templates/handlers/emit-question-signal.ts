#!/usr/bin/env bun
/**
 * emit-question-signal.ts - Deterministic CLARIFY_QUESTION Signal Emission
 *
 * Called directly by relay.clarify command BEFORE AskUserQuestion.
 * This gives us full control over signal timing - no dependency on hooks.
 *
 * Pattern: See README.md in this directory for the deterministic signal emission pattern.
 *
 * Usage:
 *   bun emit-question-signal.ts question "What notification types should we support?"
 *   bun emit-question-signal.ts complete "Clarification finished"
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

async function main() {
  // Parse mode and text from arguments
  const mode = process.argv[2] || "question";
  const text = process.argv[3] || (mode === "complete" ? "Phase completed" : "Agent asked a question");

  try {
    // Get current registry
    const registry = await resolveRegistry();
    if (!registry) {
      console.error('[EmitQuestionSignal] No registry found - not in orchestrated mode');
      process.exit(0);
    }

    // Map mode to state: "complete" -> "completed", "question" -> "awaitingInput"
    const state = mode === "complete" ? "completed" : "awaitingInput";

    // Build phase-specific signal (e.g., CLARIFY_COMPLETE or CLARIFY_QUESTION)
    const status = mapResponseState(state, registry.current_step);
    const detail = truncateDetail(text);
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

    console.error(`[EmitQuestionSignal] Sent ${status} to ${target}`);
    console.error(`[EmitQuestionSignal] Mode: ${mode}, Text: ${text}`);
  } catch (error) {
    console.error('[EmitQuestionSignal] Error:', error);
    process.exit(1);
  }
}

main();
