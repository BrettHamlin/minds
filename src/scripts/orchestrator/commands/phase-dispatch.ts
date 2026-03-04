#!/usr/bin/env bun

/**
 * phase-dispatch.ts - Dispatch a pipeline phase to the agent pane
 *
 * Reads phase command from pipeline.json, checks coordination.json for
 * hold conditions, reads agent pane from registry, and sends the command
 * to the agent via TmuxClient.
 *
 * This is a generic interpreter: phase rules live in pipeline.json.
 * Adding, renaming, or reordering phases requires NO changes to this script.
 *
 * Usage:
 *   bun commands/phase-dispatch.ts <TICKET_ID> <PHASE_ID> [--args "extra args"]
 *
 * Output (stdout):
 *   "Dispatched <phase_id> to <agent_pane>: <command>"
 *   If held: "HELD: <ticket_id> at <phase_id> — waiting for <dep_id>:<dep_phase>"
 *
 * Exit codes:
 *   0 = dispatched, held, or terminal no-op
 *   1 = usage error
 *   2 = validation error (phase not found)
 *   3 = file error (registry/pipeline.json missing)
 */

import * as fs from "fs";
import * as path from "path";
import {
  getRepoRoot,
  readJsonFile,
  writeJsonAtomic,
  getRegistryPath,
  resolvePipelineConfigPath,
  TmuxClient,
  OrchestratorError,
  handleError,
} from "../../../lib/pipeline";
import type { CompiledPipeline, CompiledPhase, CompiledAction } from "../../../lib/pipeline";
import { applyUpdates } from "../../../lib/pipeline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HoldResult {
  held: boolean;
  reason?: string;  // "dep_ticket:dep_phase" if held
}

export interface DispatchResult {
  dispatched: boolean;
  received: boolean;
  paneId: string;
  command: string;
}

// ---------------------------------------------------------------------------
// Phase command resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the command (string) or actions (array) for a phase.
 * Returns null if phase exists but has no dispatchable command (terminal).
 * Throws OrchestratorError if phase not found.
 */
export function resolvePhaseCommand(
  pipeline: CompiledPipeline,
  phaseId: string
): { type: "command"; value: string } | { type: "actions"; value: CompiledAction[] } | null {
  const phase = pipeline.phases[phaseId];
  if (!phase) {
    throw new OrchestratorError("VALIDATION", `Phase '${phaseId}' not found in pipeline.json`);
  }

  if (phase.command) {
    return { type: "command", value: phase.command };
  }

  if (phase.actions && phase.actions.length > 0) {
    return { type: "actions", value: phase.actions };
  }

  return null; // Terminal or no-op phase
}

// ---------------------------------------------------------------------------
// Hold check
// ---------------------------------------------------------------------------

interface WaitForEntry {
  ticket_id?: string;
  id?: string;
  phase: string;
}

/**
 * Check whether the ticket should be held due to unsatisfied dependencies.
 */
export function checkHoldStatus(
  ticketId: string,
  phaseId: string,
  repoRoot: string,
  registryDir: string
): HoldResult {
  const coordPath = path.join(repoRoot, "specs", ticketId, "coordination.json");
  if (!fs.existsSync(coordPath)) {
    return { held: false };
  }

  const coord = readJsonFile(coordPath);
  if (!coord) return { held: false };

  const waitFor: WaitForEntry[] = coord.wait_for || [];
  if (waitFor.length === 0) return { held: false };

  for (const dep of waitFor) {
    const depTicket = dep.ticket_id || dep.id;
    const depPhase = dep.phase;
    if (!depTicket || !depPhase) continue;

    const depRegPath = getRegistryPath(registryDir, depTicket);
    const depReg = readJsonFile(depRegPath);
    if (!depReg) {
      return { held: true, reason: `${depTicket}:${depPhase}` };
    }

    const history: Array<{ phase: string; signal: string }> = depReg.phase_history || [];
    const satisfied = history.some(
      (e) => e.phase === depPhase && e.signal.endsWith("_COMPLETE")
    );
    if (!satisfied) {
      return { held: true, reason: `${depTicket}:${depPhase}` };
    }
  }

  return { held: false };
}

// ---------------------------------------------------------------------------
// Bus dispatch
// ---------------------------------------------------------------------------

/**
 * Publish a command to the bus for delivery to the agent pane via the
 * bus-command-bridge daemon (last-mile tmux delivery on the agent side).
 */
export async function publishCommandToBus(
  busUrl: string,
  ticketId: string,
  phase: string,
  command: string,
  agentPane: string
): Promise<{ published: boolean }> {
  try {
    const resp = await fetch(`${busUrl}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: `pipeline-${ticketId}`,
        from: "orchestrator",
        type: "command",
        payload: { command, phase, agent_pane: agentPane },
      }),
      signal: AbortSignal.timeout(5000),
    });
    return { published: resp.ok };
  } catch {
    return { published: false };
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const RECEIPT_POLL_INTERVAL_MS = 2000;
const RECEIPT_POLL_ATTEMPTS = 8; // 16s total

export interface TransportOpts {
  transport?: string;
  busUrl?: string;
  ticketId?: string;
  phase?: string;
}

/**
 * Send a command to the agent pane and verify receipt.
 *
 * When transportOpts.transport is "bus" and busUrl/ticketId are provided,
 * publishes via the bus (command-bridge handles last-mile tmux delivery).
 * Falls back to direct tmux send-keys when transport is "tmux" or unset.
 */
export async function dispatchToAgent(
  paneId: string,
  command: string,
  delay: number = 1,
  transportOpts?: TransportOpts
): Promise<DispatchResult> {
  const transport = transportOpts?.transport ?? "tmux";
  const busUrl = transportOpts?.busUrl;
  const ticketId = transportOpts?.ticketId;

  if (transport === "bus" && busUrl && ticketId) {
    const result = await publishCommandToBus(
      busUrl,
      ticketId,
      transportOpts?.phase ?? "unknown",
      command,
      paneId
    );
    return { dispatched: true, received: result.published, paneId, command };
  }

  const tmux = new TmuxClient();

  // Capture pane before send
  const before = tmux.capturePane(paneId);

  // Send command
  tmux.sendKeys(paneId, command, delay);

  // Poll for receipt: check that pane content changed and contains the command
  let received = false;
  for (let i = 0; i < RECEIPT_POLL_ATTEMPTS; i++) {
    await tmux.sleep(RECEIPT_POLL_INTERVAL_MS);
    const after = tmux.capturePane(paneId);
    if (after !== before) {
      received = true;
      break;
    }
  }

  if (!received) {
    // Resend C-m as fallback (agent may have buffered command but not submitted)
    console.error(`Warning: agent pane unchanged after dispatch; resending C-m`);
    tmux.run(["send-keys", "-t", paneId, "", "C-m"]);
  }

  return { dispatched: true, received, paneId, command };
}

// ---------------------------------------------------------------------------
// Command building
// ---------------------------------------------------------------------------

/**
 * Append extra args to a base command string.
 * Returns baseCmd unchanged when extraArgs is null or empty.
 */
export function buildDispatchCommand(baseCmd: string, extraArgs: string | null): string {
  return extraArgs ? `${baseCmd} ${extraArgs}` : baseCmd;
}

/**
 * Extract the first dispatchable command string from a resolvePhaseCommand() result.
 * - command phases: returns the command string directly.
 * - actions phases: returns the first command or prompt action's string.
 * - null (terminal/no-op): returns null.
 */
export function getDispatchableCommand(
  resolved: ReturnType<typeof resolvePhaseCommand>
): string | null {
  if (!resolved) return null;
  if (resolved.type === "command") return resolved.value;
  for (const action of resolved.value) {
    if ("command" in action && action.command) return action.command;
    if ("prompt" in action) return action.prompt as string;
  }
  return null;
}

/**
 * Return the before and after hook phase IDs declared on a compiled phase.
 * Returns empty arrays when the phase has no hooks or doesn't exist.
 */
export function resolvePhaseHooks(
  pipeline: CompiledPipeline,
  phaseId: string
): { before: string[]; after: string[] } {
  const phase = pipeline.phases[phaseId];
  if (!phase) return { before: [], after: [] };
  return {
    before: (phase.before ?? []).map((h) => h.phase),
    after: (phase.after ?? []).map((h) => h.phase),
  };
}

// ---------------------------------------------------------------------------
// Before-hook execution
// ---------------------------------------------------------------------------

export const HOOK_POLL_INTERVAL_MS = 2000;
export const HOOK_POLL_ATTEMPTS = 150; // 5 minutes total

/**
 * Poll the registry's phase_history until phaseId appears with a _COMPLETE signal.
 * Returns true when found, false on timeout.
 */
export async function waitForPhaseCompletion(
  registryPath: string,
  phaseId: string,
  pollAttempts: number = HOOK_POLL_ATTEMPTS
): Promise<boolean> {
  for (let i = 0; i < pollAttempts; i++) {
    const reg = readJsonFile(registryPath);
    const history: Array<{ phase: string; signal: string }> = (reg?.phase_history ?? []) as Array<{ phase: string; signal: string }>;
    if (history.some((e) => e.phase === phaseId && e.signal.endsWith("_COMPLETE"))) {
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, HOOK_POLL_INTERVAL_MS));
  }
  return false;
}

/**
 * Dispatch each before-hook phase to the agent pane and wait for completion.
 * Hook phases are dispatched sequentially; each must complete before the next starts.
 */
export async function executeBeforeHooks(
  agentPane: string,
  beforeHooks: string[],
  pipeline: CompiledPipeline,
  registryPath: string
): Promise<void> {
  for (const hookPhaseId of beforeHooks) {
    const hookCmd = getDispatchableCommand(resolvePhaseCommand(pipeline, hookPhaseId));
    if (!hookCmd) {
      console.error(`Before-hook '${hookPhaseId}' has no dispatchable command — skipping`);
      continue;
    }

    console.log(`Dispatching before-hook '${hookPhaseId}'`);
    await dispatchToAgent(agentPane, hookCmd, 1);

    const completed = await waitForPhaseCompletion(registryPath, hookPhaseId);
    if (!completed) {
      throw new OrchestratorError(
        "TIMEOUT",
        `Before-hook '${hookPhaseId}' did not complete within timeout`
      );
    }
    console.log(`Before-hook '${hookPhaseId}' completed`);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: phase-dispatch.ts <TICKET_ID> <PHASE_ID>");
    process.exit(1);
  }

  const [ticketId, phaseId] = args;
  const argsIdx = args.indexOf("--args");
  const extraArgs = argsIdx !== -1 && args[argsIdx + 1] ? args[argsIdx + 1] : null;
  const pipelineIdx = args.indexOf("--pipeline");
  const pipelineVariantFlag = pipelineIdx !== -1 && args[pipelineIdx + 1] ? args[pipelineIdx + 1] : undefined;

  try {
    const repoRoot = getRepoRoot();
    const registryDir = `${repoRoot}/.collab/state/pipeline-registry`;
    // Resolve config: explicit --pipeline flag > registry pipeline_variant > default pipeline.json
    const configPath = resolvePipelineConfigPath(repoRoot, {
      variant: pipelineVariantFlag,
      ticketId,
      registryDir,
    });

    const pipeline = readJsonFile(configPath) as CompiledPipeline | null;
    if (!pipeline) {
      throw new OrchestratorError("FILE_NOT_FOUND", `pipeline.json not found: ${configPath}`);
    }

    const regPath = getRegistryPath(registryDir, ticketId);
    const registry = readJsonFile(regPath);
    if (!registry) {
      throw new OrchestratorError("FILE_NOT_FOUND", `Registry not found for ticket: ${ticketId}`);
    }

    const agentPane = registry.agent_pane_id as string | undefined;
    if (!agentPane) {
      throw new OrchestratorError("FILE_NOT_FOUND", `No agent_pane_id in registry for ${ticketId}`);
    }

    // --- Check hold conditions ---
    const holdResult = checkHoldStatus(ticketId, phaseId, repoRoot, registryDir);
    if (holdResult.held) {
      // Update registry to held state
      writeJsonAtomic(
        regPath,
        applyUpdates(registry, {
          status: "held",
          held_at: phaseId,
          waiting_for: holdResult.reason,
        })
      );
      console.log(`HELD: ${ticketId} at ${phaseId} — waiting for ${holdResult.reason}`);
      process.exit(0);
    }

    // --- Execute before hooks ---
    const hooks = resolvePhaseHooks(pipeline, phaseId);
    if (hooks.before.length > 0) {
      await executeBeforeHooks(agentPane, hooks.before, pipeline, regPath);
    }

    // --- Resolve phase command ---
    const resolved = resolvePhaseCommand(pipeline, phaseId);

    if (!resolved) {
      // Terminal or no-op phase
      console.log(`Phase '${phaseId}' has no dispatchable command (terminal or no-op).`);
      process.exit(0);
    }

    // --- Read transport from registry ---
    const transport = (registry.transport as string | undefined) ?? "tmux";
    const busUrl = (registry.bus_url as string | undefined) ?? process.env.BUS_URL;
    const tOpts: TransportOpts = { transport, busUrl, ticketId, phase: phaseId };

    // --- Dispatch (append --args if provided) ---
    if (resolved.type === "command") {
      const fullCmd = buildDispatchCommand(getDispatchableCommand(resolved)!, extraArgs);
      const result = await dispatchToAgent(agentPane, fullCmd, 5, tOpts);
      console.log(`Dispatched ${phaseId} to ${agentPane}: ${fullCmd}`);
    } else {
      // Actions array — dispatch in order, append args to command/prompt actions
      let dispatched = false;
      for (const action of resolved.value) {
        if (action.display) {
          console.log(`[Display] ${action.display}`);
        } else if (action.prompt || action.command) {
          const baseCmd = (action.prompt || action.command) as string;
          const fullCmd = buildDispatchCommand(baseCmd, extraArgs);
          await dispatchToAgent(agentPane, fullCmd, 1, tOpts);
          console.log(`Dispatched ${phaseId} action to ${agentPane}: ${fullCmd}`);
          dispatched = true;
        }
      }
    }
  } catch (err) {
    handleError(err);
  }
}

if (import.meta.main) {
  main();
}
