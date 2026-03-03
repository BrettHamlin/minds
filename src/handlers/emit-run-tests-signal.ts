#!/usr/bin/env bun
/**
 * emit-run-tests-signal.ts - Deterministic RUN_TESTS Signal Emission
 *
 * Usage:
 *   bun emit-run-tests-signal.ts pass "All tests passed"
 *   bun emit-run-tests-signal.ts fail "3 tests failed: ..."
 *   bun emit-run-tests-signal.ts error "Test command not found"
 */

import { emitPhaseSignal } from "./emit-phase-signal";

emitPhaseSignal("run_tests", {
  pass: "completed",
  fail: "failed",
  error: "error",
});
