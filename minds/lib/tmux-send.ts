#!/usr/bin/env bun

/**
 * tmux-send.ts — Send text to a tmux pane and submit it.
 *
 * Handles the two-step send pattern: send text, wait 1s, send C-m to submit.
 * Claude Code needs the delay between text entry and submit.
 *
 * Usage:
 *   bun tmux-send.ts <pane-id> <text>
 *
 * Example:
 *   bun tmux-send.ts %1234 "Fix the bug in src/lib/metrics.ts line 42"
 */

import { execSync } from "child_process";

const [paneId, text] = process.argv.slice(2);

if (!paneId || !text) {
  console.error(JSON.stringify({ error: "Usage: tmux-send.ts <pane-id> <text>" }));
  process.exit(1);
}

try {
  // Step 1: Send the text
  execSync(`tmux send-keys -t ${paneId} ${JSON.stringify(text)}`, { stdio: "inherit" });

  // Step 2: Wait 1 second, then send C-m to submit
  await Bun.sleep(1000);
  execSync(`tmux send-keys -t ${paneId} C-m`, { stdio: "inherit" });
} catch (err) {
  console.error(JSON.stringify({ error: `Failed to send to pane ${paneId}: ${err}` }));
  process.exit(1);
}
