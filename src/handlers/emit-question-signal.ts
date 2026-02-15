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

const REGISTRY_DIR = `${process.env.HOME}/.claude/MEMORY/STATE/pipeline-registry`;
const TMUX_PATH = `${process.env.HOME}/.claude/skills/TmuxAutomation/Tools/Tmux.ts`;

// Import shared functions from pipeline-signal handler
const { mapResponseState, buildSignalMessage, resolveRegistry, truncateDetail } =
  await import(`${process.env.HOME}/.claude/hooks/handlers/pipeline-signal.ts`);

async function main() {
  const questionText = process.argv[2] || "Agent asked a question";

  try {
    // Get current registry
    const registry = await resolveRegistry();
    if (!registry) {
      console.error('[EmitQuestionSignal] No registry found - not in orchestrated mode');
      process.exit(0);
    }

    // Build CLARIFY_QUESTION signal (phase-specific)
    const status = mapResponseState("awaitingInput", registry.current_step);
    const detail = truncateDetail(questionText);
    const signalMessage = buildSignalMessage(registry, status, detail);

    // Send to orchestrator pane
    const target = registry.orchestrator_pane_id || registry.orchestrator_window_id;
    await $`bun ${TMUX_PATH} send -w ${target} -t ${signalMessage} -d 1`.quiet();

    console.error(`[EmitQuestionSignal] Sent ${status} to ${target}`);
    console.error(`[EmitQuestionSignal] Question: ${questionText}`);
  } catch (error) {
    console.error('[EmitQuestionSignal] Error:', error);
    process.exit(1);
  }
}

main();
