#!/usr/bin/env bun
/**
 * emit-signal.ts - Generic phase-aware signal emitter
 *
 * Reads the current phase from the pipeline registry (single source of truth).
 * Agents call this instead of phase-specific handlers, eliminating the class of
 * bug where an agent calls the wrong handler and emits the wrong phase's signal.
 *
 * Usage:
 *   bun emit-signal.ts <event> "detail message"
 *
 * Events: complete, pass, warn, fail, reject, error, start, question, questions
 *
 * The phase name comes from registry.current_step — NOT from the filename.
 * Signal name is resolved via resolveSignalName() from the pipeline config.
 */

import { resolveRegistry } from "./pipeline-signal";
import { emitPhaseSignal } from "./emit-phase-signal";

// Covers ALL events across ALL phases
const GENERIC_EVENT_MAP: Record<string, string> = {
  complete: "completed",
  pass: "completed",
  warn: "completed",
  fail: "failed",
  reject: "failed",
  error: "error",
  start: "processing",
  question: "awaitingInput",
  questions: "questions",
};

async function main() {
  const registry = await resolveRegistry();
  if (!registry) {
    console.error("[EmitSignal] No registry found - not in orchestrated mode");
    process.exit(0);
  }

  const phaseName = registry.current_step;
  if (!phaseName) {
    console.error("[EmitSignal] No current_step in registry");
    process.exit(1);
  }

  await emitPhaseSignal(phaseName, GENERIC_EVENT_MAP);
}

main();
