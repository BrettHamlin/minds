#!/usr/bin/env bun
/**
 * emit-question-signal.ts - CLARIFY_QUESTION / CLARIFY_COMPLETE Signal Emission
 *
 * Thin wrapper around emitPhaseSignal factory.
 * Inherits bus transport support automatically from the factory.
 *
 * Usage:
 *   bun emit-question-signal.ts question "What notification types should we support?"
 *   bun emit-question-signal.ts complete "Clarification finished"
 */

import { emitPhaseSignal } from "./emit-phase-signal";

emitPhaseSignal("clarify", {
  question: "awaitingInput",
  complete: "completed",
});
