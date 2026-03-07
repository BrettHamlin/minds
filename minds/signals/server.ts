/**
 * Signals Mind — signal emission handlers, transport dispatch, token resolution.
 *
 * Owns: emit-phase-signal, emit-*-signal handlers, pipeline-signal utilities,
 * resolve-tokens, question-signal hook.
 *
 * Leaf Mind: no children.
 */

import { createMind } from "../server-base.js";
import type { WorkUnit, WorkResult } from "../mind.js";

async function handle(workUnit: WorkUnit): Promise<WorkResult> {
  const ctx = (workUnit.context ?? {}) as Record<string, unknown>;

  switch (workUnit.intent) {
    case "emit signal": {
      const { emitPhaseSignal } = await import("./emit-phase-signal.js");
      const phaseName = ctx.phase as string | undefined;
      const eventMap = ctx.eventMap as Record<string, string> | undefined;
      if (!phaseName || !eventMap) {
        return { status: "handled", error: "Missing context.phase or context.eventMap" };
      }
      await emitPhaseSignal(phaseName, eventMap);
      return { status: "handled", result: { ok: true } };
    }

    case "resolve signal name": {
      const { resolveSignalName } = await import("./pipeline-signal.js");
      const phaseName = ctx.phase as string | undefined;
      const event = ctx.event as string | undefined;
      const registry = ctx.registry;
      if (!phaseName || !event) {
        return { status: "handled", error: "Missing context.phase or context.event" };
      }
      const name = resolveSignalName(phaseName, event, registry);
      return { status: "handled", result: { signalName: name } };
    }

    case "emit phase signal": {
      const { emitPhaseSignal } = await import("./emit-phase-signal.js");
      const phaseName = ctx.phase as string | undefined;
      const eventMap = ctx.eventMap as Record<string, string> | undefined;
      if (!phaseName || !eventMap) {
        return { status: "handled", error: "Missing context.phase or context.eventMap" };
      }
      await emitPhaseSignal(phaseName, eventMap);
      return { status: "handled", result: { ok: true } };
    }

    default:
      return { status: "escalate" };
  }
}

export default createMind({
  name: "signals",
  domain: "Signal emission handlers, transport dispatch, token resolution, and phase signal utilities.",
  keywords: ["signal", "emit", "phase", "event", "queue", "token", "resolve", "handler"],
  owns_files: ["minds/signals/"],
  capabilities: [
    "emit signal",
    "resolve signal name",
    "emit phase signal",
  ],
  exposes: ["emit signal", "resolve signal name", "emit phase signal"],
  consumes: [
    "pipeline_core/loadPipelineForTicket",
    "pipeline_core/signal",
    "transport/resolveTransportPath",
  ],
  handle,
});
