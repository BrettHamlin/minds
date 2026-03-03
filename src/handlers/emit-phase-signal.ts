#!/usr/bin/env bun
/**
 * emit-phase-signal.ts - Generic phase signal emission factory
 *
 * Extracts the shared pattern from emit-blindqa-signal.ts, emit-run-tests-signal.ts,
 * etc. Each phase handler becomes a thin wrapper that calls emitPhaseSignal() with
 * its phase name and event-to-responseState mapping.
 *
 * Usage (from a thin wrapper):
 *   import { emitPhaseSignal } from "./emit-phase-signal";
 *   emitPhaseSignal("blindqa", { start: "awaitingInput", pass: "completed", fail: "failed" });
 */

import { $ } from "bun";
import { execSync } from "child_process";
import * as fs from "fs";

function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
}

/**
 * Emit a pipeline signal for a given phase.
 *
 * @param phaseName   - Pipeline phase (e.g. "blindqa", "run_tests")
 * @param eventMap    - Maps CLI event strings to responseState strings
 *                      understood by mapResponseState (e.g. "completed", "failed", "error", "awaitingInput")
 * @param fallbackState - responseState to use for unknown events (default: "error")
 */
export async function emitPhaseSignal(
  phaseName: string,
  eventMap: Record<string, string>,
  fallbackState = "error",
): Promise<void> {
  const REPO_ROOT = getRepoRoot();
  const TMUX_PATH = `${REPO_ROOT}/.collab/scripts/orchestrator/Tmux.ts`;
  const tag = `Emit${phaseName.charAt(0).toUpperCase() + phaseName.slice(1)}Signal`;

  const { mapResponseState, buildSignalMessage, resolveRegistry, truncateDetail } =
    await import("./pipeline-signal.ts");

  const event = process.argv[2];
  const detailText = process.argv[3] || `${phaseName} ${event}`;

  if (!event) {
    console.error(`[${tag}] Usage: bun emit-${phaseName}-signal.ts <${Object.keys(eventMap).join("|")}> "detail message"`);
    process.exit(1);
  }

  try {
    const registry = await resolveRegistry();
    if (!registry) {
      console.error(`[${tag}] No registry found - not in orchestrated mode`);
      process.exit(0);
    }

    if (registry.current_step !== phaseName) {
      console.error(`[${tag}] Warning: current_step is "${registry.current_step}", expected "${phaseName}"`);
    }

    const responseState = eventMap[event];
    if (!responseState) {
      console.error(`[${tag}] Unknown event: ${event}`);
    }
    const status = mapResponseState(responseState ?? fallbackState, registry.current_step);
    const detail = truncateDetail(detailText);
    const signalMessage = buildSignalMessage(registry, status, detail);

    // Persist signal to queue before tmux send (survives orchestrator context compaction)
    const queueDir = `${REPO_ROOT}/.collab/state/signal-queue`;
    fs.mkdirSync(queueDir, { recursive: true });
    const queueFile = `${queueDir}/${registry.ticket_id}.json`;
    const queueTmp = `${queueFile}.tmp`;
    fs.writeFileSync(queueTmp, JSON.stringify({ signal: signalMessage, emitted_at: new Date().toISOString() }, null, 2) + "\n");
    fs.renameSync(queueTmp, queueFile);

    // Send to orchestrator pane (best-effort — queue file is the durable artifact)
    const target = registry.orchestrator_pane_id || registry.orchestrator_window_id;
    try {
      await $`bun ${TMUX_PATH} send -w ${target} -t ${signalMessage} -d 1`.quiet();
    } catch (sendError) {
      console.error(`[${tag}] Warning: tmux send failed (signal persisted to queue)`);
    }

    console.error(`[${tag}] Sent ${status} to ${target}`);
    console.error(`[${tag}] Event: ${event}, Detail: ${detailText}`);
  } catch (error) {
    console.error(`[${tag}] Error:`, error);
    process.exit(1);
  }
}
