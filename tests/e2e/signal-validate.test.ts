/**
 * tests/e2e/signal-validate.test.ts
 *
 * Category 4: Signal Validation — verifies parseSignal, getAllowedSignals,
 * and validateSignal work correctly with the compiled pipeline.
 *
 * Uses the real collab.pipeline as input.
 */

import { describe, test, expect } from "bun:test";
import { parseSignal, getAllowedSignals } from "../../src/lib/pipeline/signal";
import { validateSignal } from "../../src/scripts/orchestrator/signal-validate";
import { compileCollab } from "./helpers";

// ── Compile once ──────────────────────────────────────────────────────────────

const compiled = compileCollab();

// ── Category 4a: parseSignal ──────────────────────────────────────────────────

describe("e2e/signal-validate: parseSignal()", () => {
  test("1. parses a valid orchestrator signal string", () => {
    const raw = "[SIGNAL:BRE-123:abc12] CLARIFY_COMPLETE | All questions answered";
    const result = parseSignal(raw);
    expect(result).not.toBeNull();
    expect(result!.ticketId).toBe("BRE-123");
    expect(result!.nonce).toBe("abc12");
    expect(result!.signalType).toBe("CLARIFY_COMPLETE");
    expect(result!.detail).toBe("All questions answered");
  });

  test("2. returns null for invalid format (missing pipe separator)", () => {
    expect(parseSignal("[SIGNAL:BRE-123:abc12] CLARIFY_COMPLETE")).toBeNull();
  });

  test("3. returns null for empty string", () => {
    expect(parseSignal("")).toBeNull();
  });

  test("4. returns null for pipelang simple format (not orchestrator format)", () => {
    expect(parseSignal("[SIGNAL] CLARIFY_COMPLETE")).toBeNull();
  });

  test("5. parses various signal types from each phase", () => {
    const signals = [
      "PLAN_COMPLETE",
      "TASKS_ERROR",
      "ANALYZE_COMPLETE",
      "IMPLEMENT_WAITING",
      "BLINDQA_FAILED",
    ];
    for (const sig of signals) {
      const raw = `[SIGNAL:BRE-001:dead01] ${sig} | detail`;
      const result = parseSignal(raw);
      expect(result, `Failed to parse signal: ${sig}`).not.toBeNull();
      expect(result!.signalType).toBe(sig);
    }
  });
});

// ── Category 4b: getAllowedSignals ────────────────────────────────────────────

describe("e2e/signal-validate: getAllowedSignals(compiled, phaseId)", () => {
  test("6. clarify phase returns its signal list", () => {
    const allowed = getAllowedSignals(compiled, "clarify");
    expect(allowed).not.toBeNull();
    expect(allowed).toContain("CLARIFY_COMPLETE");
    expect(allowed).toContain("CLARIFY_QUESTION");
    expect(allowed).toContain("CLARIFY_ERROR");
  });

  test("7. plan phase returns PLAN_COMPLETE and PLAN_ERROR", () => {
    const allowed = getAllowedSignals(compiled, "plan");
    expect(allowed).not.toBeNull();
    expect(allowed).toContain("PLAN_COMPLETE");
    expect(allowed).toContain("PLAN_ERROR");
  });

  test("8. implement phase includes IMPLEMENT_COMPLETE, IMPLEMENT_WAITING, IMPLEMENT_ERROR", () => {
    const allowed = getAllowedSignals(compiled, "implement");
    expect(allowed).not.toBeNull();
    expect(allowed).toContain("IMPLEMENT_COMPLETE");
    expect(allowed).toContain("IMPLEMENT_WAITING");
    expect(allowed).toContain("IMPLEMENT_ERROR");
  });

  test("9. blindqa phase includes all 5 signals", () => {
    const allowed = getAllowedSignals(compiled, "blindqa");
    expect(allowed).not.toBeNull();
    expect(allowed).toContain("BLINDQA_COMPLETE");
    expect(allowed).toContain("BLINDQA_FAILED");
    expect(allowed).toContain("BLINDQA_ERROR");
    expect(allowed).toContain("BLINDQA_QUESTION");
    expect(allowed).toContain("BLINDQA_WAITING");
  });

  test("10. done (terminal, no signals declared) returns null", () => {
    const allowed = getAllowedSignals(compiled, "done");
    expect(allowed).toBeNull();
  });

  test("11. unknown phase returns null", () => {
    const allowed = getAllowedSignals(compiled, "nonexistent-phase");
    expect(allowed).toBeNull();
  });
});

// ── Category 4c: validateSignal ───────────────────────────────────────────────

describe("e2e/signal-validate: validateSignal(parsed, registry, compiled)", () => {
  const VALID_PARSED = {
    ticketId: "BRE-123",
    nonce: "abc123",
    signalType: "CLARIFY_COMPLETE",
    detail: "done",
  };

  const VALID_REGISTRY = {
    nonce: "abc123",
    current_step: "clarify",
  };

  test("12. valid parsed + matching nonce + allowed signal → valid: true", () => {
    const result = validateSignal(VALID_PARSED, VALID_REGISTRY, compiled);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.ticket_id).toBe("BRE-123");
      expect(result.signal_type).toBe("CLARIFY_COMPLETE");
      expect(result.current_step).toBe("clarify");
      expect(result.nonce).toBe("abc123");
    }
  });

  test("13. nonce mismatch → valid: false, error: Nonce mismatch", () => {
    const result = validateSignal(
      { ...VALID_PARSED, nonce: "wrong-nonce" },
      VALID_REGISTRY,
      compiled
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Nonce mismatch");
    }
  });

  test("14. signal not allowed for current phase → valid: false", () => {
    const result = validateSignal(
      { ...VALID_PARSED, signalType: "PLAN_COMPLETE" }, // PLAN_COMPLETE not valid for clarify
      VALID_REGISTRY,
      compiled
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Signal type not valid for current phase");
    }
  });

  test("15. current_step not in pipeline → valid: false, unknown current_step", () => {
    const result = validateSignal(VALID_PARSED, { ...VALID_REGISTRY, current_step: "unknown-phase" }, compiled);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Unknown current_step in registry");
    }
  });

  test("16. valid signal for implement phase → valid: true", () => {
    const result = validateSignal(
      { ticketId: "BRE-999", nonce: "xf1a2b", signalType: "IMPLEMENT_COMPLETE", detail: "ok" },
      { nonce: "xf1a2b", current_step: "implement" },
      compiled
    );
    expect(result.valid).toBe(true);
  });

  test("17. valid BLINDQA_QUESTION signal (lifecycle notification) → valid: true", () => {
    const result = validateSignal(
      { ticketId: "BRE-999", nonce: "xf1a2b", signalType: "BLINDQA_QUESTION", detail: "question" },
      { nonce: "xf1a2b", current_step: "blindqa" },
      compiled
    );
    expect(result.valid).toBe(true);
  });
});
