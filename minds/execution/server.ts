/**
 * Execution Mind — phase dispatch, gate evaluation, signal validation,
 * orchestrator init, phase executors, hooks, retry config, and execution mode.
 *
 * Owns: phase-dispatch, evaluate-gate, signal-validate, orchestrator-init,
 * phase-advance, dispatch-phase-hooks, registry-update, resolve-execution-mode,
 * resolve-retry-config, analyze-task-phases, status-table, registry-read.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const req = workUnit.request.toLowerCase().trim();
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  // "dispatch phase" — dispatch the next phase for a ticket
  if (req.startsWith("dispatch phase")) {
    const { dispatchPhase } = await import("./phase-dispatch.js");
    const ticketId = ctx.ticketId as string | undefined;
    const repoRoot = ctx.repoRoot as string | undefined;
    if (!ticketId || !repoRoot) {
      return { status: "handled", error: "Missing context.ticketId or context.repoRoot" };
    }
    try {
      const result = await dispatchPhase(repoRoot, ticketId, ctx);
      return { status: "handled", result };
    } catch (err: any) {
      return { status: "handled", error: err.message };
    }
  }

  // "evaluate gate" — resolve gate prompt or validate verdict for a ticket
  if (req.startsWith("evaluate gate")) {
    const { resolveGatePrompt, validateGateVerdict } = await import("./evaluate-gate.js");
    const ticketId = ctx.ticketId as string | undefined;
    const phase = ctx.phase as string | undefined;
    const verdict = ctx.verdict as string | undefined;
    if (!ticketId || !phase) {
      return { status: "handled", error: "Missing context.ticketId or context.phase" };
    }
    if (verdict) {
      const valid = validateGateVerdict(verdict);
      return { status: "handled", result: { valid } };
    }
    const prompt = resolveGatePrompt(ticketId, phase, ctx);
    return { status: "handled", result: { prompt } };
  }

  // "validate signal" — parse and validate an incoming pipeline signal
  if (req.startsWith("validate signal")) {
    const { validateSignal } = await import("./signal-validate.js");
    const parsed = ctx.parsed as any;
    const registry = ctx.registry as any;
    const pipeline = ctx.pipeline as any;
    if (!parsed || !registry || !pipeline) {
      return { status: "handled", error: "Missing context.parsed, context.registry, or context.pipeline" };
    }
    const result = validateSignal(parsed, registry, pipeline);
    return { status: "handled", result };
  }

  // "advance phase" — advance a ticket to the next pipeline phase
  if (req.startsWith("advance phase")) {
    const { getNextPhase, isTerminalPhase } = await import("./phase-advance.js");
    const pipeline = ctx.pipeline as any;
    const currentPhase = ctx.currentPhase as string | undefined;
    if (!pipeline || !currentPhase) {
      return { status: "handled", error: "Missing context.pipeline or context.currentPhase" };
    }
    const nextPhase = getNextPhase(pipeline, currentPhase);
    const terminal = isTerminalPhase(pipeline, nextPhase);
    return { status: "handled", result: { nextPhase, terminal } };
  }

  // "init orchestrator" — initialize orchestrator for a ticket
  if (req.startsWith("init orchestrator")) {
    const { resolvePaths } = await import("./orchestrator-init.js");
    const ticketId = ctx.ticketId as string | undefined;
    const repoRoot = ctx.repoRoot as string | undefined;
    if (!ticketId || !repoRoot) {
      return { status: "handled", error: "Missing context.ticketId or context.repoRoot" };
    }
    try {
      const result = resolvePaths(ctx as any);
      return { status: "handled", result };
    } catch (err: any) {
      return { status: "handled", error: err.message };
    }
  }

  // "resolve execution mode" — detect interactive vs autonomous execution mode
  if (req.startsWith("resolve execution mode")) {
    const { resolveMode } = await import("./resolve-execution-mode.js");
    const configPath = ctx.configPath as string | undefined;
    if (!configPath) {
      return { status: "handled", error: "Missing context.configPath" };
    }
    const mode = resolveMode(configPath, ctx.defaultMode as string | undefined);
    return { status: "handled", result: { mode } };
  }

  // "resolve retry config" — get phase retry config from pipeline and history
  if (req.startsWith("resolve retry config")) {
    const { resolveRetryConfig } = await import("./resolve-retry-config.js");
    const ticketId = ctx.ticketId as string | undefined;
    const repoRoot = ctx.repoRoot as string | undefined;
    if (!ticketId || !repoRoot) {
      return { status: "handled", error: "Missing context.ticketId or context.repoRoot" };
    }
    try {
      const result = resolveRetryConfig(repoRoot, ticketId, ctx);
      return { status: "handled", result };
    } catch (err: any) {
      return { status: "handled", error: err.message };
    }
  }

  // "analyze task phases" — analyze phase structure from tasks.md
  if (req.startsWith("analyze task phases")) {
    const { parseTaskPhases } = await import("../pipeline_core/task-phases.js"); // CROSS-MIND
    const content = ctx.content as string | undefined;
    if (!content) {
      return { status: "handled", error: "Missing context.content" };
    }
    const result = parseTaskPhases(content);
    return { status: "handled", result };
  }

  return { status: "escalate" };
}

export default createMind({
  name: "execution",
  domain: "Phase dispatch, gate evaluation, signal validation, orchestrator init, phase executors, hooks, retry config, and execution mode.",
  keywords: ["phase", "dispatch", "gate", "signal", "validate", "orchestrator", "execute", "retry", "hooks", "mode"],
  owns_files: ["minds/execution/"],
  capabilities: [
    "dispatch phase",
    "evaluate gate",
    "validate signal",
    "advance phase",
    "init orchestrator",
    "resolve execution mode",
    "resolve retry config",
    "analyze task phases",
  ],
  handle,
});
