#!/usr/bin/env bun
/**
 * emit-spec-critique-signal.ts - Deterministic SPEC_CRITIQUE Signal Emission
 *
 * Called directly by collab.spec-critique command at key lifecycle points.
 * This gives us full control over signal timing - no dependency on hooks.
 *
 * Pattern: Matches emit-blindqa-signal.ts for consistency
 *
 * Usage:
 *   bun emit-spec-critique-signal.ts start "Starting spec analysis"
 *   bun emit-spec-critique-signal.ts pass "All HIGH issues resolved"
 *   bun emit-spec-critique-signal.ts warn "MEDIUM/LOW issues remain"
 *   bun emit-spec-critique-signal.ts fail "HIGH issues remain"
 */

import { execSync } from "child_process";
import * as fs from "fs";

function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8" }).trim();
  } catch {
    return process.cwd();
  }
}

const REPO_ROOT = getRepoRoot();

const { mapResponseState, buildSignalMessage, resolveRegistry, truncateDetail } =
  await import("./pipeline-signal.ts");

function getResponseState(event: string): string {
  switch (event) {
    case "start":
      return "awaitingInput";
    case "pass":
      return "completed";
    case "warn":
      return "completed";
    case "fail":
      return "failed";
    default:
      console.error(`[EmitSpecCritiqueSignal] Unknown event: ${event}`);
      return "completed";
  }
}

async function main() {
  const event = process.argv[2];
  const detailText = process.argv[3] || `SpecCritique ${event}`;

  if (!event) {
    console.error('[EmitSpecCritiqueSignal] Usage: bun emit-spec-critique-signal.ts <start|pass|warn|fail> "detail message"');
    process.exit(1);
  }

  try {
    const registry = await resolveRegistry();
    if (!registry) {
      console.error('[EmitSpecCritiqueSignal] No registry found - not in orchestrated mode');
      process.exit(0);
    }

    if (registry.current_step !== "spec_critique") {
      console.error(`[EmitSpecCritiqueSignal] Warning: current_step is "${registry.current_step}", expected "spec_critique"`);
    }

    const responseState = getResponseState(event);
    const status = mapResponseState(responseState, registry.current_step);
    const detail = truncateDetail(detailText);
    const signalMessage = buildSignalMessage(registry, status, detail);

    // Persist signal to queue before transport send (survives orchestrator context compaction)
    const queueDir = `${REPO_ROOT}/.collab/state/signal-queue`;
    fs.mkdirSync(queueDir, { recursive: true });
    const queueFile = `${queueDir}/${registry.ticket_id}.json`;
    const queueTmp = `${queueFile}.tmp`;
    fs.writeFileSync(queueTmp, JSON.stringify({ signal: signalMessage, emitted_at: new Date().toISOString() }, null, 2) + "\n");
    fs.renameSync(queueTmp, queueFile);

    // Dispatch via transport
    const { dispatchSignal } = await import("./emit-phase-signal.ts");
    const target = registry.orchestrator_pane_id || registry.orchestrator_window_id;
    await dispatchSignal(signalMessage, target, "spec_critique", registry.ticket_id, registry.nonce, "");

    console.error(`[EmitSpecCritiqueSignal] Sent ${status} to ${target}`);
    console.error(`[EmitSpecCritiqueSignal] Event: ${event}, Detail: ${detailText}`);
  } catch (error) {
    console.error('[EmitSpecCritiqueSignal] Error:', error);
    process.exit(1);
  }
}

main();
