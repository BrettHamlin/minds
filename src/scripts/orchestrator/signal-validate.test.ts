import { describe, expect, test } from "bun:test";
import {
  parseSignal,
  validateSignal,
  type ParsedSignal,
  type ValidationResult,
} from "./signal-validate";

// ============================================================================
// Test fixtures
// ============================================================================

const PIPELINE = {
  version: "3.0",
  phases: [
    {
      id: "clarify",
      signals: ["CLARIFY_COMPLETE", "CLARIFY_QUESTION", "CLARIFY_ERROR"],
    },
    { id: "plan", signals: ["PLAN_COMPLETE", "PLAN_ERROR"] },
    {
      id: "blindqa",
      signals: [
        "BLINDQA_COMPLETE",
        "BLINDQA_FAILED",
        "BLINDQA_ERROR",
        "BLINDQA_QUESTION",
        "BLINDQA_WAITING",
      ],
    },
    { id: "done", terminal: true, signals: [] },
  ],
  transitions: [],
};

const REGISTRY = {
  ticket_id: "BRE-158",
  nonce: "abc12",
  current_step: "clarify",
  status: "running",
};

// ============================================================================
// parseSignal
// ============================================================================

describe("parseSignal", () => {
  test("parses valid signal string", () => {
    const result = parseSignal(
      "[SIGNAL:BRE-158:abc12] CLARIFY_COMPLETE | All questions answered"
    );
    expect(result).toEqual({
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "CLARIFY_COMPLETE",
      detail: "All questions answered",
    });
  });

  test("parses signal with complex detail containing pipes", () => {
    const result = parseSignal(
      "[SIGNAL:BRE-200:ff00aa] PLAN_COMPLETE | Plan looks good | reviewed by team"
    );
    // The regex captures everything after " | " as detail
    // Since our regex uses (.+)$ for detail, it captures "Plan looks good | reviewed by team"
    expect(result).not.toBeNull();
    expect(result!.ticketId).toBe("BRE-200");
    expect(result!.signalType).toBe("PLAN_COMPLETE");
  });

  test("returns null for invalid format - missing brackets", () => {
    expect(parseSignal("SIGNAL:BRE-158:abc12 CLARIFY_COMPLETE | done")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseSignal("")).toBeNull();
  });

  test("returns null for plain text", () => {
    expect(parseSignal("hello world")).toBeNull();
  });

  test("returns null for signal with uppercase nonce", () => {
    expect(
      parseSignal("[SIGNAL:BRE-158:ABC12] CLARIFY_COMPLETE | done")
    ).toBeNull();
  });

  test("returns null for signal with lowercase signal type", () => {
    expect(
      parseSignal("[SIGNAL:BRE-158:abc12] clarify_complete | done")
    ).toBeNull();
  });

  test("returns null for missing detail section", () => {
    expect(
      parseSignal("[SIGNAL:BRE-158:abc12] CLARIFY_COMPLETE")
    ).toBeNull();
  });

  test("parses signal with long hex nonce", () => {
    const result = parseSignal(
      "[SIGNAL:BRE-999:deadbeef0123] PLAN_COMPLETE | done"
    );
    expect(result).not.toBeNull();
    expect(result!.nonce).toBe("deadbeef0123");
  });
});

// ============================================================================
// validateSignal
// ============================================================================

describe("validateSignal", () => {
  test("valid signal returns full output object", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "CLARIFY_COMPLETE",
      detail: "All questions answered",
    };
    const result = validateSignal(parsed, REGISTRY, PIPELINE);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.ticket_id).toBe("BRE-158");
      expect(result.signal_type).toBe("CLARIFY_COMPLETE");
      expect(result.detail).toBe("All questions answered");
      expect(result.current_step).toBe("clarify");
      expect(result.nonce).toBe("abc12");
    }
  });

  test("nonce mismatch returns valid:false", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "wrong_nonce",
      signalType: "CLARIFY_COMPLETE",
      detail: "done",
    };
    const result = validateSignal(parsed, REGISTRY, PIPELINE);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Nonce mismatch");
      expect(result.expected_nonce).toBe("abc12");
      expect(result.received_nonce).toBe("wrong_nonce");
    }
  });

  test("signal type not in allowed list returns valid:false", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "PLAN_COMPLETE",
      detail: "done",
    };
    // PLAN_COMPLETE is not valid for the "clarify" phase
    const result = validateSignal(parsed, REGISTRY, PIPELINE);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Signal type not valid for current phase");
      expect(result.current_step).toBe("clarify");
      expect(result.allowed_signals).toContain("CLARIFY_COMPLETE");
    }
  });

  test("unknown current_step returns valid:false", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "CLARIFY_COMPLETE",
      detail: "done",
    };
    const badRegistry = { ...REGISTRY, current_step: "nonexistent_phase" };
    const result = validateSignal(parsed, badRegistry, PIPELINE);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Unknown current_step in registry");
    }
  });

  test("BLINDQA_QUESTION is valid for blindqa phase", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "BLINDQA_QUESTION",
      detail: "What framework?",
    };
    const blindqaRegistry = { ...REGISTRY, current_step: "blindqa" };
    const result = validateSignal(parsed, blindqaRegistry, PIPELINE);

    expect(result.valid).toBe(true);
  });

  test("CLARIFY_QUESTION is valid for clarify phase", () => {
    const parsed: ParsedSignal = {
      ticketId: "BRE-158",
      nonce: "abc12",
      signalType: "CLARIFY_QUESTION",
      detail: "Need clarification",
    };
    const result = validateSignal(parsed, REGISTRY, PIPELINE);

    expect(result.valid).toBe(true);
  });
});
