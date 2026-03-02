import { describe, expect, test } from "bun:test";
import { resolveTransition, resolveGateResponse, type TransitionResult } from "./transition-resolve";

// ============================================================================
// Test pipeline fixture
// ============================================================================

const PIPELINE = {
  version: "3.0",
  phases: [
    { id: "clarify", signals: ["CLARIFY_COMPLETE", "CLARIFY_ERROR"] },
    { id: "plan", signals: ["PLAN_COMPLETE", "PLAN_ERROR"] },
    { id: "tasks", signals: ["TASKS_COMPLETE"] },
    { id: "implement", signals: ["IMPLEMENT_COMPLETE"] },
    { id: "done", terminal: true, signals: [] },
  ],
  transitions: [
    { from: "clarify", signal: "CLARIFY_COMPLETE", to: "plan" },
    { from: "plan", signal: "PLAN_COMPLETE", gate: "plan_review" },
    { from: "plan", signal: "PLAN_ERROR", to: "plan" },
    { from: "tasks", signal: "TASKS_COMPLETE", to: "implement" },
    { from: "implement", signal: "IMPLEMENT_COMPLETE", to: "done" },
  ],
};

// Pipeline with conditional rows for priority testing (legacy array format)
const PIPELINE_WITH_CONDITIONALS = {
  ...PIPELINE,
  transitions: [
    // Conditional row (has "if" field) -- should take priority
    {
      from: "implement",
      signal: "IMPLEMENT_COMPLETE",
      to: "hotfix",
      if: "has_critical_bugs",
    },
    // Plain row (no "if" field) -- fallback
    { from: "implement", signal: "IMPLEMENT_COMPLETE", to: "done" },
    // Other transitions
    { from: "clarify", signal: "CLARIFY_COMPLETE", to: "plan" },
  ],
};

// v3.1 object-keyed pipeline with all alternatives in conditionalTransitions
// (matches real-world scenario where blindqa is the plain fallback but lives
//  in conditionalTransitions alongside the conditional group-loop row)
const PIPELINE_V31_CONDITIONALS_ONLY = {
  version: "3.1",
  phases: {
    implement: {
      conditionalTransitions: [
        // Conditional: loop back for next group if more phases remain
        { signal: "IMPLEMENT_COMPLETE", to: "tasks", if: "hasGroup" },
        // Otherwise: advance to blindqa (no 'if' field)
        { signal: "IMPLEMENT_COMPLETE", to: "blindqa" },
      ],
      transitions: {},
    },
  },
};

// v3.1 pipeline where only a conditional row exists (no otherwise row)
const PIPELINE_V31_NO_FALLBACK = {
  version: "3.1",
  phases: {
    implement: {
      conditionalTransitions: [
        { signal: "IMPLEMENT_COMPLETE", to: "tasks", if: "hasGroup" },
      ],
      transitions: {},
    },
  },
};

// ============================================================================
// resolveTransition
// ============================================================================

describe("resolveTransition", () => {
  test("simple to transition (clarify -> CLARIFY_COMPLETE -> plan)", () => {
    const result = resolveTransition("clarify", "CLARIFY_COMPLETE", PIPELINE);
    expect(result).toEqual({
      to: "plan",
      gate: null,
      if: null,
      conditional: false,
    });
  });

  test("gate transition (plan -> PLAN_COMPLETE -> plan_review gate)", () => {
    const result = resolveTransition("plan", "PLAN_COMPLETE", PIPELINE);
    expect(result).toEqual({
      to: null,
      gate: "plan_review",
      if: null,
      conditional: false,
    });
  });

  test("no match returns null", () => {
    const result = resolveTransition("clarify", "NONEXISTENT_SIGNAL", PIPELINE);
    expect(result).toBeNull();
  });

  test("no match for unknown phase returns null", () => {
    const result = resolveTransition("unknown_phase", "CLARIFY_COMPLETE", PIPELINE);
    expect(result).toBeNull();
  });

  test("conditional rows take priority over plain rows", () => {
    const result = resolveTransition(
      "implement",
      "IMPLEMENT_COMPLETE",
      PIPELINE_WITH_CONDITIONALS
    );
    expect(result).not.toBeNull();
    expect(result!.conditional).toBe(true);
    expect(result!.to).toBe("hotfix");
    expect(result!.if).toBe("has_critical_bugs");
  });

  test("plainOnly flag skips conditional rows", () => {
    const result = resolveTransition(
      "implement",
      "IMPLEMENT_COMPLETE",
      PIPELINE_WITH_CONDITIONALS,
      true
    );
    expect(result).not.toBeNull();
    expect(result!.conditional).toBe(false);
    expect(result!.to).toBe("done");
    expect(result!.if).toBeNull();
  });

  // v3.1 object-keyed format: all transitions in conditionalTransitions

  test("v3.1: conditional row returned when plainOnly is false", () => {
    const result = resolveTransition(
      "implement",
      "IMPLEMENT_COMPLETE",
      PIPELINE_V31_CONDITIONALS_ONLY
    );
    expect(result).not.toBeNull();
    expect(result!.conditional).toBe(true);
    expect(result!.to).toBe("tasks");
    expect(result!.if).toBe("hasGroup");
  });

  test("v3.1 plainOnly: returns otherwise row (no 'if') when conditional fails", () => {
    const result = resolveTransition(
      "implement",
      "IMPLEMENT_COMPLETE",
      PIPELINE_V31_CONDITIONALS_ONLY,
      true
    );
    expect(result).not.toBeNull();
    expect(result!.conditional).toBe(false);
    expect(result!.to).toBe("blindqa");
    expect(result!.if).toBeNull();
  });

  test("v3.1 plainOnly: returns null when no otherwise row exists", () => {
    const result = resolveTransition(
      "implement",
      "IMPLEMENT_COMPLETE",
      PIPELINE_V31_NO_FALLBACK,
      true
    );
    expect(result).toBeNull();
  });

  test("returns null for null pipeline", () => {
    expect(resolveTransition("clarify", "CLARIFY_COMPLETE", null)).toBeNull();
  });

  test("returns null for pipeline without transitions array", () => {
    expect(
      resolveTransition("clarify", "CLARIFY_COMPLETE", { version: "3.0" })
    ).toBeNull();
  });

  test("returns null for pipeline without gates object", () => {
    expect(resolveTransition("clarify", "CLARIFY_COMPLETE", { version: "3.0" })).toBeNull();
  });

  test("error-to-self transition works", () => {
    const result = resolveTransition("plan", "PLAN_ERROR", PIPELINE);
    expect(result).toEqual({
      to: "plan",
      gate: null,
      if: null,
      conditional: false,
    });
  });

  test("terminal transition works", () => {
    const result = resolveTransition(
      "implement",
      "IMPLEMENT_COMPLETE",
      PIPELINE
    );
    expect(result).toEqual({
      to: "done",
      gate: null,
      if: null,
      conditional: false,
    });
  });
});

// ============================================================================
// resolveGateResponse
// ============================================================================

const PIPELINE_WITH_GATES = {
  ...PIPELINE,
  gates: {
    plan_review: {
      prompt: ".collab/config/gates/plan.md",
      on: {
        APPROVED: { to: "tasks" },
        REVISION_NEEDED: { to: "plan", feedback: "enrich" },
      },
    },
  },
};

describe("resolveGateResponse", () => {
  test("returns gate response for known keyword", () => {
    const result = resolveGateResponse(PIPELINE_WITH_GATES, "plan_review", "APPROVED");
    expect(result).toEqual({ to: "tasks" });
  });

  test("returns response with feedback for retry keyword", () => {
    const result = resolveGateResponse(PIPELINE_WITH_GATES, "plan_review", "REVISION_NEEDED");
    expect(result).not.toBeNull();
    expect((result as any).feedback).toBe("enrich");
    expect((result as any).to).toBe("plan");
  });

  test("returns null for unknown gate", () => {
    expect(resolveGateResponse(PIPELINE_WITH_GATES, "nonexistent_gate", "APPROVED")).toBeNull();
  });

  test("returns null for unknown keyword within known gate", () => {
    expect(resolveGateResponse(PIPELINE_WITH_GATES, "plan_review", "UNKNOWN_KEYWORD")).toBeNull();
  });

  test("returns null for null pipeline", () => {
    expect(resolveGateResponse(null, "plan_review", "APPROVED")).toBeNull();
  });

  test("returns null for pipeline without gates field", () => {
    expect(resolveGateResponse(PIPELINE, "plan_review", "APPROVED")).toBeNull();
  });
});
