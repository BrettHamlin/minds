#!/usr/bin/env bun
/**
 * emit-spec-critique-signal.ts - SPEC_CRITIQUE Signal Emission
 *
 * Thin wrapper around emitPhaseSignal factory.
 * Inherits bus transport support automatically from the factory.
 *
 * Usage:
 *   bun emit-spec-critique-signal.ts start "Starting spec analysis"
 *   bun emit-spec-critique-signal.ts pass "All HIGH issues resolved"
 *   bun emit-spec-critique-signal.ts warn "MEDIUM/LOW issues remain"
 *   bun emit-spec-critique-signal.ts fail "HIGH issues remain"
 */

import { emitPhaseSignal } from "./emit-phase-signal";

emitPhaseSignal("spec_critique", {
  start: "processing",
  pass: "completed",
  warn: "completed",
  fail: "failed",
});
