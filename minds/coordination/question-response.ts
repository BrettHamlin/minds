#!/usr/bin/env bun
/**
 * question-response.ts — Send a question response to agent, bus-aware
 *
 * Usage:
 *   bun question-response.ts <TICKET_ID> <STEPS>
 *
 * Reads transport + bus_url + agent_pane_id from registry.
 * If transport=bus: publishes question_response to bus (bridge delivers via tmux)
 * If transport=tmux: sends Down×steps + Enter directly via tmux send-keys
 *
 * STEPS is the number of Down-arrow presses before Enter (0 = first option).
 */

import { spawnSync } from "child_process";
// TODO(WD): These should be requested via parent escalation once Pipeline Core is a Mind.
import {
  getRepoRoot,
  readJsonFile,
  registryPath,
  OrchestratorError,
  handleError,
} from "../pipeline_core";

// ---------------------------------------------------------------------------
// Core logic (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Send a question response using the transport configured for the ticket.
 * - bus transport: publishes question_response message to bus channel
 * - tmux transport (default): sends Down×steps + Enter directly to agent pane
 */
export async function questionResponse(
  ticketId: string,
  steps: number,
  opts?: { repoRoot?: string; fetch?: typeof globalThis.fetch }
): Promise<void> {
  const repoRoot = opts?.repoRoot ?? getRepoRoot();
  const fetchFn = opts?.fetch ?? globalThis.fetch;

  const regPath = registryPath(repoRoot, ticketId);
  const registry = readJsonFile(regPath);

  const transport = (registry?.transport as string | undefined) ?? "tmux";
  const busUrl = (registry?.bus_url as string | undefined) ?? process.env.BUS_URL;
  const agentPane = (registry?.agent_pane_id as string | undefined) ?? "";

  if (transport === "bus" && busUrl) {
    try {
      await fetchFn(`${busUrl}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: `pipeline-${ticketId}`,
          from: "orchestrator",
          type: "question_response",
          payload: { steps },
        }),
        signal: AbortSignal.timeout(5000),
      });
      console.error(`[QuestionResponse] Published to bus (steps=${steps})`);
    } catch (err) {
      console.error(`[QuestionResponse] Bus publish failed: ${err}. Falling back to tmux.`);
      await tmuxFallback(agentPane, steps);
    }
  } else {
    await tmuxFallback(agentPane, steps);
  }
}

async function tmuxFallback(agentPane: string, steps: number): Promise<void> {
  if (!agentPane) {
    console.error("[QuestionResponse] No agent pane ID — cannot send tmux keys");
    return;
  }

  // Wait 2s for AskUserQuestion UI to render
  await new Promise<void>((resolve) => setTimeout(resolve, 2000));

  for (let i = 0; i < steps; i++) {
    spawnSync("tmux", ["send-keys", "-t", agentPane, "Down"], { stdio: "ignore" });
  }
  spawnSync("tmux", ["send-keys", "-t", agentPane, "Enter"], { stdio: "ignore" });
  console.error(`[QuestionResponse] Sent Down×${steps} + Enter to pane ${agentPane}`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const [ticketId, stepsStr] = process.argv.slice(2);

  if (!ticketId || stepsStr === undefined) {
    console.error("Usage: question-response.ts <TICKET_ID> <STEPS>");
    process.exit(1);
  }

  const steps = parseInt(stepsStr, 10);
  if (isNaN(steps) || steps < 0) {
    console.error("ERROR: STEPS must be a non-negative integer");
    process.exit(1);
  }

  try {
    await questionResponse(ticketId, steps);
  } catch (err) {
    handleError(err);
  }
}
