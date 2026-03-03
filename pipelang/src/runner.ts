// Pipelang runtime — executes a compiled pipeline using tmux agent panes
//
// Signal format emitted by agents:
//   [SIGNAL] SIGNAL_NAME
//   [SIGNAL] SIGNAL_NAME | optional detail
//
// Usage:
//   import { runPipeline } from "./runner";
//   const result = await runPipeline(compiledPipeline, { signalTimeoutMs: 30_000 });

import type { CompiledPipeline, CompiledGate, CompiledTransition, ConditionalTransitionRow } from "../../src/lib/pipeline/types";
import { tmux, sleepMs, sendToPane, openAgentPane, pollForSignal } from "./tmux";
import { resolveTransport } from "../../transport/index.ts";

// ── Agent lifecycle interface ─────────────────────────────────────────────────

export interface AgentLifecycle {
  /** Shell command to run in the tmux window (e.g. "claude --dangerously-skip-permissions") */
  windowCmd: string;
  /** If set, this text is sent to the pane after it opens (the slash command for Claude). */
  sendAfterOpen?: string;
  /** ms to wait before sending sendAfterOpen (gives the agent time to start). Default: 0 */
  waitForPromptMs?: number;
}

// ── Runner options ────────────────────────────────────────────────────────────

export interface RunOptions {
  /** tmux session name. If omitted, a unique session is created and destroyed after the run. */
  session?: string;
  /** ms to wait for a signal before timing out. Default: 30000 */
  signalTimeoutMs?: number;
  /** Working directory for agent panes. Default: process.cwd() */
  workDir?: string;
  /**
   * Factory that returns the agent lifecycle config for a phase.
   * Default: opens claude, waits 3s, then sends phaseCommand as a slash command.
   * Override in tests to inject fast stub agents.
   */
  agentLifecycle?: (phaseName: string, phaseCommand: string) => AgentLifecycle;
  /**
   * Factory that returns the agent lifecycle config for a gate evaluation.
   * Default: opens claude, waits 3s, then sends `/collab.gate <gateName>`.
   * Override in tests to inject deterministic gate responses.
   */
  gateLifecycle?: (gateName: string, gatePrompt: string | { ai: string } | { inline: string }) => AgentLifecycle;
  /**
   * Pipeline-level directives (e.g. ["@debug"]) used to select the Transport
   * implementation via resolveTransport(). Default: [] (auto-detect).
   */
  directives?: string[];
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface PhaseRun {
  phase: string;
  signal: string;
}

export interface RunResult {
  success: boolean;
  phases: PhaseRun[];
  error?: string;
}

// ── Pure gate routing logic and conditional transitions ───────────────────────
// Imported and re-exported from shared library

import { resolveGateResponse, resolveConditionalTransition } from "../../src/lib/pipeline/transitions";
export { resolveGateResponse, resolveConditionalTransition };

// ── Gate execution ────────────────────────────────────────────────────────────

async function executeGate(
  gateName: string,
  gate: CompiledGate,
  session: string,
  signalTimeoutMs: number,
  workDir: string,
  lifecycle: AgentLifecycle,
  retryTracker: Map<string, number>
): Promise<{ nextPhase: string } | { error: string }> {
  const paneId = await openAgentPane(session, `gate-${gateName}`, lifecycle.windowCmd, workDir);
  if (!paneId) {
    return { error: `Failed to open tmux pane for gate '${gateName}' after 3 attempts` };
  }

  if (lifecycle.sendAfterOpen) {
    if ((lifecycle.waitForPromptMs ?? 0) > 0) {
      await sleepMs(lifecycle.waitForPromptMs!);
    }
    await sendToPane(paneId, lifecycle.sendAfterOpen);
  }

  const allowedSignals = Object.keys(gate.on);
  const signal = await pollForSignal(paneId, allowedSignals, signalTimeoutMs);
  tmux("kill-pane", "-t", paneId);

  if (!signal) {
    return { error: `Timeout in gate '${gateName}' (expected: [${allowedSignals.join(", ")}])` };
  }

  const retriesSoFar = retryTracker.get(signal) ?? 0;
  const result = resolveGateResponse(gateName, gate, signal, retriesSoFar);

  // If routing back to a phase (retry path), increment the counter
  if ("nextPhase" in result && gate.on[signal].maxRetries !== undefined) {
    retryTracker.set(signal, retriesSoFar + 1);
  }

  return result;
}

// ── Core runner ───────────────────────────────────────────────────────────────

export async function runPipeline(
  pipeline: CompiledPipeline,
  opts: RunOptions = {}
): Promise<RunResult> {
  const {
    session = `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    signalTimeoutMs = 30_000,
    workDir = process.cwd(),
    agentLifecycle = (_name, cmd) => ({
      windowCmd: "claude --dangerously-skip-permissions",
      sendAfterOpen: cmd,
      waitForPromptMs: 3_000,
    }),
    gateLifecycle = (name, _prompt) => ({
      windowCmd: "claude --dangerously-skip-permissions",
      sendAfterOpen: `/collab.gate ${name}`,
      waitForPromptMs: 3_000,
    }),
    directives = [],
  } = opts;

  // Resolve transport based on pipeline directives and environment.
  // TmuxTransport is the default; BusTransport is selected when the bus
  // is reachable and @debug is not set. Existing tmux calls below are
  // unchanged — BRE-345/346 will wire them to the transport methods.
  const _transport = await resolveTransport(directives);

  const phaseKeys = Object.keys(pipeline.phases);
  if (phaseKeys.length === 0) {
    return { success: false, phases: [], error: "Pipeline has no phases" };
  }

  // Create a detached tmux session for this pipeline run
  if (!tmux("new-session", "-d", "-s", session, "-c", workDir).ok) {
    return { success: false, phases: [], error: `Failed to create tmux session '${session}'` };
  }

  const phases: PhaseRun[] = [];
  // Per-gate retry counters: gateRetries[gateName][signal] = number of retries used
  const gateRetries = new Map<string, Map<string, number>>();

  try {
    let current = phaseKeys[0];

    while (true) {
      const phase = pipeline.phases[current];
      if (!phase) {
        return { success: false, phases, error: `Unknown phase: '${current}'` };
      }

      // Terminal phase → pipeline complete
      if (phase.terminal) {
        return { success: true, phases };
      }

      if (!phase.command) {
        return {
          success: false,
          phases,
          error: `Phase '${current}' has no command and is not terminal`,
        };
      }

      const lifecycle = agentLifecycle(current, phase.command);

      // Open a new tmux window for this agent (reliable: retries up to 3x)
      const paneId = await openAgentPane(session, current, lifecycle.windowCmd, workDir);
      if (!paneId) {
        return {
          success: false,
          phases,
          error: `Failed to open tmux pane for phase '${current}' after 3 attempts`,
        };
      }

      // If the lifecycle sends a slash command after the agent starts, wait then send
      if (lifecycle.sendAfterOpen) {
        if ((lifecycle.waitForPromptMs ?? 0) > 0) {
          await sleepMs(lifecycle.waitForPromptMs!);
        }
        await sendToPane(paneId, lifecycle.sendAfterOpen);
      }

      // Poll pane output until we see a valid signal or timeout
      const allowedSignals = phase.signals ?? [];
      const signal = await pollForSignal(paneId, allowedSignals, signalTimeoutMs);

      // Always close the pane after capturing (or timing out)
      tmux("kill-pane", "-t", paneId);

      if (!signal) {
        return {
          success: false,
          phases,
          error: `Timeout in phase '${current}' (expected: [${allowedSignals.join(", ")}])`,
        };
      }

      phases.push({ phase: current, signal });

      // Look up the transition for this signal — check transitions first,
      // then fall back to conditionalTransitions
      const rawTransition: CompiledTransition | null =
        phase.transitions?.[signal] ??
        (phase.conditionalTransitions
          ? resolveConditionalTransition(phase.conditionalTransitions, signal)
          : null);

      if (!rawTransition) {
        return {
          success: false,
          phases,
          error: `No transition for signal '${signal}' in phase '${current}'`,
        };
      }

      if ("to" in rawTransition) {
        // Simple phase-to-phase transition
        current = rawTransition.to;
      } else {
        // Gate transition — run gate evaluation and route to the next phase
        const gateName = rawTransition.gate;
        const gate = pipeline.gates?.[gateName];
        if (!gate) {
          return {
            success: false,
            phases,
            error: `Gate '${gateName}' referenced by phase '${current}' not found in pipeline`,
          };
        }

        if (!gateRetries.has(gateName)) gateRetries.set(gateName, new Map());
        const retryTracker = gateRetries.get(gateName)!;

        const gateResult = await executeGate(
          gateName,
          gate,
          session,
          signalTimeoutMs,
          workDir,
          gateLifecycle(gateName, gate.prompt),
          retryTracker
        );

        if ("error" in gateResult) {
          return { success: false, phases, error: gateResult.error };
        }

        current = gateResult.nextPhase;
      }
    }
  } finally {
    // Always clean up the session regardless of outcome
    tmux("kill-session", "-t", session);
  }
}
