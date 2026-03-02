#!/usr/bin/env bun
/**
 * question-signal.hook.ts - Emit PHASE_QUESTION signal to orchestrator
 *
 * Fires on PreToolUse:AskUserQuestion in orchestrated agent sessions.
 * Enables the orchestrator to navigate AskUserQuestion UIs autonomously
 * without human intervention.
 *
 * TRIGGER: PreToolUse
 * MATCHER: AskUserQuestion
 *
 * Flow:
 *   1. Read $TMUX_PANE — exit if not in tmux
 *   2. Scan .collab/state/pipeline-registry/ for entry where agent_pane_id matches
 *   3. Send [SIGNAL:{ticket_id}:{nonce}] {PHASE}_QUESTION to orchestrator pane
 *   4. Always exit 0 — never block the UI
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";

const TMUX_PANE = process.env.TMUX_PANE;

// Not in a tmux session — not orchestrated, exit silently
if (!TMUX_PANE) process.exit(0);

// Registry dir is sibling of this hook's parent dir:
// .collab/hooks/../state/pipeline-registry = .collab/state/pipeline-registry
// import.meta.dir resolves symlinks, so this always points to the real .collab/
const REGISTRY_DIR = join(import.meta.dir, "..", "state", "pipeline-registry");

async function main() {
  try {
    const files = readdirSync(REGISTRY_DIR).filter(
      (f) => f.endsWith(".json") && !f.endsWith(".tmp")
    );

    for (const file of files) {
      try {
        const entry = JSON.parse(
          readFileSync(join(REGISTRY_DIR, file), "utf-8")
        );

        if (entry.agent_pane_id !== TMUX_PANE) continue;

        const { ticket_id, nonce, orchestrator_pane_id, current_step } = entry;
        if (!ticket_id || !nonce || !orchestrator_pane_id || !current_step) break;

        const signalType = `${current_step.toUpperCase()}_QUESTION`;
        const signal = `[SIGNAL:${ticket_id}:${nonce}] ${signalType} | agent awaiting input`;

        // Two separate calls required — Claude Code ignores \n (Enter) but responds to \r (C-m).
        // Must wait 1s between text arrival and C-m so the target app processes the text first.
        await $`tmux send-keys -t ${orchestrator_pane_id} ${signal}`.quiet();
        await Bun.sleep(1000);
        await $`tmux send-keys -t ${orchestrator_pane_id} C-m`.quiet();
        break;
      } catch {
        // Skip malformed registry files
        continue;
      }
    }
  } catch {
    // No registry dir or not in collab context — silent no-op
  }

  process.exit(0);
}

main();
