#!/usr/bin/env bun
/**
 * emit-code-review-signal.ts - Deterministic CODE_REVIEW Signal Emission
 *
 * Usage:
 *   bun emit-code-review-signal.ts pass "Review passed"
 *   bun emit-code-review-signal.ts fail "Blocking findings: ..."
 */

import { emitPhaseSignal } from "./emit-phase-signal";

emitPhaseSignal("code_review", {
  pass: "completed",
  fail: "failed",
});
