#!/usr/bin/env bun
/**
 * PreToolUse.question-signal.ts - Emit PHASE_QUESTION signal to orchestrator
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
 *   2. Detect repo root via `git rev-parse` and resolve minds dir
 *   3. Scan {mindsDir}/state/pipeline-registry/ for entry where agent_pane_id matches
 *   4. Send [SIGNAL:{ticket_id}:{nonce}] {PHASE}_QUESTION to orchestrator pane
 *   5. Always exit 0 — never block the UI
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { $ } from "bun";

const TMUX_PANE = process.env.TMUX_PANE;

// Not in a tmux session — not orchestrated, exit silently
if (!TMUX_PANE) process.exit(0);

// Resolve repo root and minds directory dynamically.
// This hook lives at .claude/hooks/ in installed repos or minds/hooks/ in dev.
// Using git is the most reliable way to find the root regardless of location.
let REGISTRY_DIR: string;
try {
  const repoRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  const mindsDir = existsSync(join(repoRoot, "minds", "cli")) ? "minds" : ".minds";
  REGISTRY_DIR = join(repoRoot, mindsDir, "state", "pipeline-registry");
} catch {
  // Not in a git repo — can't resolve paths, exit silently
  process.exit(0);
}

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

        // Persist signal to queue before tmux send (survives orchestrator context compaction)
        const queueDir = join(REGISTRY_DIR, "..", "signal-queue");
        mkdirSync(queueDir, { recursive: true });
        const queueFile = join(queueDir, `${ticket_id}.json`);
        const queueTmp = `${queueFile}.tmp`;
        writeFileSync(queueTmp, JSON.stringify({ signal, emitted_at: new Date().toISOString() }, null, 2) + "\n");
        renameSync(queueTmp, queueFile);

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
